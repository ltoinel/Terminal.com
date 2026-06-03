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
  const ask = ctx.append(`<div class="ln out">Are you sure you want to continue connecting (yes/no)? <span class="cmd ask"></span></div>`);
  await ctx.type(ask.querySelector('.ask'), 'yes', 90);
  await ctx.sleep(200);
  ctx.sysLine(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.`);
  await ctx.sleep(420);
  ctx.exec('motd');
---
