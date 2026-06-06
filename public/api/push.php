<?php
/**
 * api/push.php — Web Push backend for ludovic.toinel.com.
 *
 * One endpoint, two actions selected by the `action` query parameter:
 *
 *   ?action=send       (default) — deliver a visitor's message to the owner's
 *                       browser(s) via Web Push. The `msg <text>` command POSTs
 *                       here; every registered subscription is notified.
 *   ?action=subscribe  — register THIS browser as a recipient (owner only). The
 *                       `msg --subscribe <secret>` flow POSTs the browser's
 *                       PushSubscription plus the shared secret.
 *
 * Both actions share the VAPID keys / secret in push.config.php, which lives ONE
 * LEVEL ABOVE the document root (above `dist/`), so it is never web-served. As
 * this script sits in `dist/api/`, that base is two directories up
 * (`__DIR__ . '/../..'`). The writable runtime state — the recipient list
 * (push-store.json), the rate-limit counters (push-rate.json) and the attempt
 * log (msg.log) — lives in a `data/` subdirectory of that base, which must be
 * writable by the web server (php-fpm) user.
 *
 * Abuse protection on the public `send` action (it pings the owner's device):
 *  - per-IP cooldown between two messages,
 *  - per-IP daily quota,
 *  - global daily quota (hard cap protecting the owner),
 *  - an append-only log of every attempt.
 * Counters live in a single flock-protected JSON file so concurrent requests
 * cannot race past the limits.
 *
 * Response: JSON { ok: bool, sent?: int, recipients?: int, error?: string }.
 */

declare(strict_types=1);

// JSON endpoint: never let a PHP notice/warning (e.g. the web-push GMP hint) leak
// into the response body. Errors are surfaced explicitly via out().
ini_set('display_errors', '0');

/* ------------------------------- tunables --------------------------------- */
const IP_COOLDOWN  = 20;      // seconds between two messages from the same IP
const IP_DAILY_MAX = 15;      // max messages per IP per (UTC) day
const GLOBAL_DAILY_MAX = 120; // max total messages per (UTC) day
const MSG_MAX_LEN  = 300;     // characters

/** Base directory — one level above the document root (above dist/). Holds
 *  push.config.php; the writable state lives in its `data/` subdirectory. */
$ROOT = __DIR__ . '/../..';
$DATA = $ROOT . '/data';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: https://ludovic.toinel.com');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Vary: Origin');

function out(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Client IP — REMOTE_ADDR by default, or a trusted proxy header if configured. */
function client_ip(array $config): string
{
    $header = $config['trusted_ip_header'] ?? '';
    if ($header !== '' && !empty($_SERVER[$header])) {
        // A forwarded list ("client, proxy1, …") — keep the first (left-most) entry.
        return trim(explode(',', (string) $_SERVER[$header])[0]);
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** Append one tab-separated line to the attempt log (best-effort). */
function log_attempt(string $file, string $ip, string $result, string $msg): void
{
    $line = sprintf(
        "%s\t%s\t%s\t%s\n",
        gmdate('c'),
        $ip,
        $result,
        str_replace(["\n", "\r", "\t"], ' ', mb_substr($msg, 0, 120)),
    );
    @file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
}

/**
 * Per-IP + global daily rate limiting, persisted under flock.
 * Returns null when allowed, or [retryAfterSeconds, reason] when blocked.
 * Fails open (returns null) if the state file cannot be opened.
 */
function rate_limit(string $ip, string $file): ?array
{
    $fh = @fopen($file, 'c+');
    if (!$fh) {
        return null;
    }
    flock($fh, LOCK_EX);
    $state = json_decode(stream_get_contents($fh) ?: '{}', true) ?: [];

    $today = gmdate('Y-m-d');
    if (($state['day'] ?? '') !== $today) {
        $state = ['day' => $today, 'global' => 0, 'ips' => []];
    }
    $now = time();
    $rec = $state['ips'][$ip] ?? ['last' => 0, 'count' => 0];

    $blocked = null;
    $since = $now - (int) $rec['last'];
    if ($since < IP_COOLDOWN) {
        $blocked = [IP_COOLDOWN - $since, 'cooldown'];
    } elseif ((int) $rec['count'] >= IP_DAILY_MAX) {
        $blocked = [0, 'ip_daily_limit'];
    } elseif ((int) ($state['global'] ?? 0) >= GLOBAL_DAILY_MAX) {
        $blocked = [0, 'global_daily_limit'];
    }

    if ($blocked === null) {
        $rec = ['last' => $now, 'count' => (int) $rec['count'] + 1];
        $state['ips'][$ip] = $rec;
        $state['global'] = (int) ($state['global'] ?? 0) + 1;
        // Keep the file bounded: drop IPs idle for over an hour.
        if (count($state['ips']) > 500) {
            $state['ips'] = array_filter(
                $state['ips'],
                fn($r) => $now - (int) $r['last'] < 3600,
            );
        }
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($state));
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    return $blocked;
}

/* --------------------------- action: subscribe ---------------------------- */
/** Registers (owner-only) the posted PushSubscription as a recipient. */
function handle_subscribe(array $config, string $data): never
{
    if (empty($config['secret'])) {
        out(500, ['ok' => false, 'error' => 'not_configured']);
    }

    $body = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($body)) {
        out(400, ['ok' => false, 'error' => 'bad_request']);
    }

    // Constant-time secret check — owner-only gate.
    if (!hash_equals((string) $config['secret'], (string) ($body['secret'] ?? ''))) {
        out(403, ['ok' => false, 'error' => 'forbidden']);
    }

    $sub = $body['subscription'] ?? null;
    if (
        !is_array($sub) || empty($sub['endpoint'])
        || empty($sub['keys']['p256dh']) || empty($sub['keys']['auth'])
    ) {
        out(400, ['ok' => false, 'error' => 'invalid_subscription']);
    }

    $store = $data . '/push-store.json';
    $subs = is_file($store) ? (json_decode((string) file_get_contents($store), true) ?: []) : [];
    // Replace any existing entry for the same endpoint (re-subscribe is idempotent).
    $subs = array_values(array_filter($subs, fn($s) => ($s['endpoint'] ?? '') !== $sub['endpoint']));
    $subs[] = [
        'endpoint' => $sub['endpoint'],
        'keys' => ['p256dh' => $sub['keys']['p256dh'], 'auth' => $sub['keys']['auth']],
    ];

    if (@file_put_contents($store, json_encode($subs, JSON_UNESCAPED_SLASHES), LOCK_EX) === false) {
        out(500, ['ok' => false, 'error' => 'store_not_writable']);
    }
    out(200, ['ok' => true, 'recipients' => count($subs)]);
}

/* ------------------------------ action: send ------------------------------ */
/** Delivers a visitor's message to every registered recipient via Web Push. */
function handle_send(array $config, string $root, string $data): never
{
    if (empty($config['publicKey']) || empty($config['privateKey'])) {
        out(500, ['ok' => false, 'error' => 'not_configured']);
    }

    require $root . '/vendor/autoload.php';

    $ip = client_ip($config);
    $logFile = $data . '/msg.log';

    // Message: accept a form field or a JSON body.
    $msg = $_POST['msg'] ?? '';
    if ($msg === '') {
        $json = json_decode((string) file_get_contents('php://input'), true);
        if (is_array($json) && isset($json['msg'])) {
            $msg = $json['msg'];
        }
    }
    $msg = trim((string) $msg);
    if ($msg === '') {
        out(400, ['ok' => false, 'error' => 'empty_message']);
    }
    if (mb_strlen($msg) > MSG_MAX_LEN) {
        $msg = mb_substr($msg, 0, MSG_MAX_LEN - 1) . '…';
    }

    // Rate limiting.
    $limit = rate_limit($ip, $data . '/push-rate.json');
    if ($limit !== null) {
        log_attempt($logFile, $ip, 'blocked:' . $limit[1], $msg);
        $body = ['ok' => false, 'error' => 'rate_limited'];
        if ($limit[0] > 0) {
            $body['retry_after'] = $limit[0];
        }
        out(429, $body);
    }

    // Recipients.
    $store = $data . '/push-store.json';
    $subs = is_file($store) ? (json_decode((string) file_get_contents($store), true) ?: []) : [];
    if (!$subs) {
        log_attempt($logFile, $ip, 'sent:0(no_recipient)', $msg);
        out(200, ['ok' => true, 'sent' => 0]); // nobody registered yet
    }

    $webPush = new \Minishlink\WebPush\WebPush(['VAPID' => [
        'subject' => $config['subject'] ?? 'mailto:admin@localhost',
        'publicKey' => $config['publicKey'],
        'privateKey' => $config['privateKey'],
    ]]);
    // A country hint (if a CDN provides it) helps the owner spot spam at a glance.
    $country = $_SERVER['HTTP_CF_IPCOUNTRY'] ?? '';
    $title = '💬 message · terminal' . ($country !== '' && $country !== 'XX' ? " ({$country})" : '');
    $payload = json_encode(['title' => $title, 'body' => $msg], JSON_UNESCAPED_UNICODE);

    foreach ($subs as $s) {
        try {
            $webPush->queueNotification(\Minishlink\WebPush\Subscription::create($s), $payload);
        } catch (\Throwable $e) {
            // Skip a malformed stored entry rather than failing the whole request.
        }
    }

    $sent = 0;
    $expired = [];
    foreach ($webPush->flush() as $report) {
        if ($report->isSuccess()) {
            $sent++;
        } elseif ($report->isSubscriptionExpired()) {
            $expired[$report->getEndpoint()] = true;
        }
    }
    // Drop endpoints the push service has retired (404 / 410).
    if ($expired) {
        $subs = array_values(array_filter($subs, fn($s) => !isset($expired[$s['endpoint']])));
        @file_put_contents($store, json_encode($subs, JSON_UNESCAPED_SLASHES), LOCK_EX);
    }

    log_attempt($logFile, $ip, 'sent:' . $sent, $msg);
    out(200, ['ok' => true, 'sent' => $sent]);
}

/* ------------------------------ entry point ------------------------------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$config = @require $ROOT . '/push.config.php';
if (!is_array($config)) {
    out(500, ['ok' => false, 'error' => 'not_configured']);
}

// Ensure the writable state directory exists (best-effort; on a hardened deploy
// it is created with the right owner/permissions ahead of time).
if (!is_dir($DATA)) {
    @mkdir($DATA, 0775, true);
}

$action = $_GET['action'] ?? 'send';
if ($action === 'subscribe') {
    handle_subscribe($config, $DATA);
} elseif ($action === 'send') {
    handle_send($config, $ROOT, $DATA);
}
out(404, ['ok' => false, 'error' => 'unknown_action']);
