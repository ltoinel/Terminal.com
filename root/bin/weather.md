---
name: weather
desc: current weather — e.g. weather, weather Tokyo
man: |
  # WEATHER(1)

  ## NAME
  weather — show the current weather

  ## SYNOPSIS
  weather [city]

  ## DESCRIPTION
  Shows the current weather (temperature, feels-like, wind, humidity)
  for the given city. With no argument, uses your approximate location
  (IP geolocation). Data from wttr.in.

  ## EXAMPLES
  weather
  weather Tokyo

  ## SEE ALSO
  checkip
js: |
  const city = ctx.args.filter((a) => !a.startsWith('-')).join(' ').trim();
  const label = city || 'your location';
  ctx.line(`weather · ${label} …`);
  // wttr.in's `j1` format is CORS-enabled JSON (cleaner than scraping its text
  // output) and ships English descriptions via `weatherDesc`. Empty city = geo-IP.
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=en`;
  // WWO weather codes -> emoji (grouped; anything unknown gets a thermometer).
  const icon = (code) => {
    const c = Number(code);
    if (c === 113) return '☀️';
    if (c === 116) return '⛅';
    if ([119, 122].includes(c)) return '☁️';
    if ([143, 248, 260].includes(c)) return '🌫️';
    if ([176, 263, 266, 293, 296, 353].includes(c)) return '🌦️';
    if ([299, 302, 305, 308, 356, 359].includes(c)) return '🌧️';
    if ([200, 386, 389, 392, 395].includes(c)) return '⛈️';
    if (c >= 179 && c <= 377) return '🌨️';
    return '🌡️';
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const cur = j.current_condition && j.current_condition[0];
    if (!cur) { ctx.error(`weather: ${label}: location not found`); return; }
    const area = (j.nearest_area && j.nearest_area[0]) || {};
    const pick = (a) => (a && a[0] && a[0].value) || '';
    const place = [pick(area.areaName), pick(area.country)].filter(Boolean).join(', ') || label;
    const desc = pick(cur.weatherDesc) || '';
    const e = ctx.escape;
    ctx.append(
      `<div class="ssh-out">` +
        `<div class="ln"><span class="accent text-glow">${e(place)}</span>  ${icon(cur.weatherCode)} <span class="out">${e(desc)}</span></div>` +
        `<div class="ln"><span class="comment">🌡️  temperature </span><span class="out">${e(cur.temp_C)}°C</span><span class="comment"> (feels like ${e(cur.FeelsLikeC)}°C)</span></div>` +
        `<div class="ln"><span class="comment">💨  wind </span><span class="out">${e(cur.windspeedKmph)} km/h ${e(cur.winddir16Point)}</span></div>` +
        `<div class="ln"><span class="comment">💧  humidity </span><span class="out">${e(cur.humidity)}%</span></div>` +
        `</div>`,
    );
    ctx.append('<div class="ln comment">via wttr.in</div>');
  } catch (e) {
    ctx.error(`weather: service unavailable (${e.message || e.name})`);
  }
---
