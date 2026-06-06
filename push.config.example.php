<?php
/**
 * Template for push.config.php (Web Push backend). Copy to `push.config.php`
 * (same place, one level above DocumentRoot=dist/) and fill in your own values.
 *
 * Generate a fresh VAPID key pair with:
 *   php -r 'require "vendor/autoload.php"; var_export(Minishlink\WebPush\VAPID::createVapidKeys());'
 * Generate the owner secret with:
 *   php -r 'echo bin2hex(random_bytes(16)), "\n";'
 *
 * The publicKey must also be copied into root/bin/msg.md (VAPID_PUBLIC_KEY).
 */
return [
    'publicKey'  => 'YOUR_VAPID_PUBLIC_KEY',
    'privateKey' => 'YOUR_VAPID_PRIVATE_KEY',
    'subject'    => 'mailto:you@example.com',
    'secret'     => 'YOUR_OWNER_REGISTRATION_SECRET',
    // Real client IP header behind a CDN/proxy (e.g. 'HTTP_CF_CONNECTING_IP').
    // Empty = trust REMOTE_ADDR (nginx directly facing the client).
    'trusted_ip_header' => '',
];
