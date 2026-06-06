<?php
/**
 * push-subscribe.php — registers a browser as a Web Push recipient (owner only).
 *
 * The `msg --subscribe <secret>` flow (root/bin/msg.md) POSTs the browser's
 * PushSubscription here together with the shared secret. Only a request carrying
 * the correct secret (set in push.config.php) is allowed to register — so
 * visitors can send messages but cannot make themselves recipients.
 *
 * Body (JSON): { secret: string, subscription: PushSubscriptionJSON }.
 */

declare(strict_types=1);

// JSON endpoint: keep the response body clean even if php.ini has display_errors on.
ini_set('display_errors', '0');

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

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$config = @require __DIR__ . '/../push.config.php';
if (!is_array($config) || empty($config['secret'])) {
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

$store = __DIR__ . '/../push-store.json';
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
