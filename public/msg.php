<?php
/**
 * msg.php — delivers a visitor's message to the owner's browser via Web Push.
 *
 * The `msg <text>` command POSTs here. We load every registered subscription
 * (push-store.json, populated by push-subscribe.php) and send each one an
 * encrypted Web Push using the VAPID keys in push.config.php. Expired
 * subscriptions are pruned automatically.
 *
 * Abuse protection (the endpoint is public and pings the owner's device):
 *  - per-IP cooldown between two messages,
 *  - per-IP daily quota,
 *  - global daily quota (hard cap protecting the owner),
 *  - an append-only log of every attempt.
 * Counters live in a single flock-protected JSON file so concurrent requests
 * cannot race past the limits.
 *
 * Response: JSON { ok: bool, sent?: int, error?: string }.
 */

declare(strict_types=1);

// JSON endpoint: never let a PHP notice/warning (e.g. the web-push GMP hint) leak
// into the response body. Errors are surfaced explicitly via out().
ini_set('display_errors', '0');

require __DIR__ . '/../vendor/autoload.php';

use Minishlink\WebPush\WebPush;
use Minishlink\WebPush\Subscription;

/* ------------------------------- tunables --------------------------------- */
const IP_COOLDOWN  = 20;   // seconds between two messages from the same IP
const IP_DAILY_MAX = 15;   // max messages per IP per (UTC) day
const GLOBAL_DAILY_MAX = 120; // max total messages per (UTC) day
const MSG_MAX_LEN  = 300;  // characters

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
function log_attempt(string $ip, string $result, string $msg): void
{
    $line = sprintf(
        "%s\t%s\t%s\t%s\n",
        gmdate('c'),
        $ip,
        $result,
        str_replace(["\n", "\r", "\t"], ' ', mb_substr($msg, 0, 120)),
    );
    @file_put_contents(__DIR__ . '/../msg.log', $line, FILE_APPEND | LOCK_EX);
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

/* ------------------------------ entry point ------------------------------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$config = @require __DIR__ . '/../push.config.php';
if (!is_array($config) || empty($config['publicKey']) || empty($config['privateKey'])) {
    out(500, ['ok' => false, 'error' => 'not_configured']);
}
$ip = client_ip($config);

/* -------------------------------- message --------------------------------- */
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

/* ----------------------------- rate limiting ------------------------------ */
$limit = rate_limit($ip, __DIR__ . '/../push-rate.json');
if ($limit !== null) {
    log_attempt($ip, 'blocked:' . $limit[1], $msg);
    $body = ['ok' => false, 'error' => 'rate_limited'];
    if ($limit[0] > 0) {
        $body['retry_after'] = $limit[0];
    }
    out(429, $body);
}

/* ------------------------------- recipients ------------------------------- */
$store = __DIR__ . '/../push-store.json';
$subs = is_file($store) ? (json_decode((string) file_get_contents($store), true) ?: []) : [];
if (!$subs) {
    log_attempt($ip, 'sent:0(no_recipient)', $msg);
    out(200, ['ok' => true, 'sent' => 0]); // nobody registered yet
}

$webPush = new WebPush(['VAPID' => [
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
        $webPush->queueNotification(Subscription::create($s), $payload);
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

log_attempt($ip, 'sent:' . $sent, $msg);
out(200, ['ok' => true, 'sent' => $sent]);
