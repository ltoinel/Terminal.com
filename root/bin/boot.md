---
name: boot
desc: replay the SSH connection
js: |
  const host = ctx.cfg.host;
  const local = `<span class="comment">visitor@web</span><span class="comment">:</span><span class="prompt-path">~</span><span class="prompt">$</span> `;
  const cmdLine = ctx.append(`<div class="ln">${local}<span class="cmd"></span></div>`);
  await ctx.type(cmdLine.querySelector('.cmd'), `ssh ${host}`, 38);
  await ctx.sleep(260);
  ctx.sysLine(`The authenticity of host '${host}' can't be established.`);
  ctx.sysLine('ED25519 key fingerprint is SHA256:kJ8x2pQ9fL7vR0nT3mW6yB1dC4hZ5sA8eG2uN9oP0qX.');
  await ctx.sleep(320);

  // Interactive confirmation: the visitor types the answer themselves.
  const question = 'Are you sure you want to continue connecting (yes/no)?';
  const answer = (await ctx.ask(question)).trim().toLowerCase();
  // Keep the Q&A in the transcript (the input line is hidden again after the read).
  ctx.append(
    `<div class="ln out">${ctx.escape(question)} <span class="cmd">${ctx.escape(answer)}</span></div>`,
  );

  if (!['yes', 'y', 'oui', 'o'].includes(answer)) {
    ctx.sysLine('Host key verification failed.');
    ctx.line('Connexion refusée. Clique sur ⏻ reconnect pour réessayer.');
    ctx.exit(); // closes the window and reveals the reconnect button
    return;
  }

  ctx.sysLine(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.`);
  await ctx.sleep(420);
  ctx.exec('motd');
---
