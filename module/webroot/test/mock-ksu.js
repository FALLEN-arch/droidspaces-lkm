// Mock KernelSU ksu.exec API for testing the WebUI without flashing.
// Simulates an Android device with a Mali GPU and Droidspaces LKM modules.
//
// Usage: open test/index.html in a desktop browser. Use the debug panel
// to toggle device states (modules loaded / not loaded, mali0 present / absent,
// MTK / non-MTK) and see how the UI responds.

(function () {
  // ---------- simulated device state ----------
  const state = {
    model: 'Pixel 7 Pro',
    kernel: '6.1.54-android13-8-g1234567',
    route: 'auto',
    version: 'v0.1.28-pre1',
    mali0: 'yes',
    render: 'yes',
    mods: 'lkm4ctr devtmpfs_lkm ip6table_nat macvlan droid_lkm_pids droid_lkm_cpu uart_guard mali_nsfix vkms',
    blacklist: '',
    flags: {
      enable_vkms: '1',
      disable_pids: '0',
      disable_cpu: '0',
      disable_uart_guard: '0',
      disable_mali: '0',
      mali_nsfix_dryrun: '0'
    },
    // mali_nsfix sysfs params
    nshf: {
      nshf_active: '1',
      nshf_probe_ok: '1',
      nshf_layout_valid: '1',
      nshf_driver: 'mali',
      nshf_seen: '42',
      nshf_hits: '128'
    },
    bootcount: '7',
    logLines: [
      '[  1.234567] mali_nsfix: module loading started',
      '[  1.234890] mali_nsfix: probe ok, driver=mali',
      '[  2.100000] vkms: registered render node /dev/dri/renderD128',
      '[  2.100123] droid_lkm_pids: pid namespace fixup active',
      '[  5.000000] mali_nsfix: layout valid, nsfix applied',
      '[ 12.345678] droid_lkm_cpu: cpu boost disabled',
      '[ 45.000000] mali_nsfix: frame submit, hits=128'
    ]
  };

  // ---------- command router ----------
  function run(cmd) {
    const lines = [];

    // HOME_CMD / DIAG_FAST_CMD share these key=value outputs
    if (cmd.includes('route=')) lines.push(`route=${state.route}`);
    if (cmd.includes('kernel=')) lines.push(`kernel=${state.kernel}`);
    if (cmd.includes('model=')) lines.push(`model=${state.model}`);
    if (cmd.includes('version=')) lines.push(`version=${state.version}`);
    if (cmd.includes('mali0=')) lines.push(`mali0=${state.mali0}`);
    if (cmd.includes('render=')) lines.push(`render=${state.render}`);
    if (cmd.includes('mods=')) lines.push(`mods=${state.mods}`);
    if (cmd.includes('blacklist=')) lines.push(`blacklist=${state.blacklist}`);

    // flag files
    state.flags && Object.entries(state.flags).forEach(([file, val]) => {
      if (cmd.includes(`flag:${file}=`)) lines.push(`flag:${file}=${val}`);
    });

    // mali_nsfix sysfs params
    if (cmd.includes('nshf_active=')) lines.push(`nshf_active=${state.nshf.nshf_active}`);
    if (cmd.includes('nshf_probe_ok=')) lines.push(`nshf_probe_ok=${state.nshf.nshf_probe_ok}`);
    if (cmd.includes('nshf_layout_valid=')) lines.push(`nshf_layout_valid=${state.nshf.nshf_layout_valid}`);
    if (cmd.includes('nshf_driver=')) lines.push(`nshf_driver=${state.nshf.nshf_driver}`);
    if (cmd.includes('nshf_seen=')) lines.push(`nshf_seen=${state.nshf.nshf_seen}`);
    if (cmd.includes('nshf_hits=')) lines.push(`nshf_hits=${state.nshf.nshf_hits}`);

    // DIAG_FAST_CMD sections
    if (cmd.includes('[modules]')) {
      lines.push('', '[modules]');
      state.mods.split(/\s+/).forEach((m) => lines.push(`${m} 0xffffffc012345000 4096 12 - Live 0xffffffc012345000 (O)`));
    }
    if (cmd.includes('[mali_nsfix]')) {
      lines.push('', '[mali_nsfix]');
    }
    if (cmd.includes('[nodes]')) {
      lines.push('', '[nodes]');
      lines.push(`mali0=${state.mali0}`);
      lines.push(`renderD128=${state.render}`);
    }
    if (cmd.includes('[state]')) {
      lines.push('', '[state]');
      lines.push(`bootcount=${state.bootcount}`);
      lines.push('disabled=no');
      lines.push(`blacklist=${state.blacklist}`);
      lines.push('last_crash_module=');
      lines.push('hang_report=no');
      lines.push(`flags=${Object.entries(state.flags).filter(([, v]) => v === '1').map(([k]) => k).join(' ') || 'none'}`);
    }
    if (cmd.includes('[log tail]')) {
      lines.push('', '[log tail]');
      state.logLines.forEach((l) => lines.push(l));
    }

    // DIAG_SLOW_CMD -> dmesg
    if (cmd.includes('dmesg')) {
      lines.push(
        '[  1.234567] mali_nsfix: module loading started',
        '[  1.234890] mali_nsfix: probe ok, driver=mali',
        '[  2.100000] vkms: registered render node /dev/dri/renderD128',
        '[ 45.000000] mali_nsfix: frame submit, hits=128'
      );
    }

    // touch / rm for flag toggling
    if (cmd.includes('touch ')) {
      const m = cmd.match(/touch ([^\s]+)/);
      if (m) state.flags[m[1].split('/').pop()] = '1';
      lines.push('');
    }
    if (cmd.includes('rm -f ')) {
      const m = cmd.match(/rm -f ([^\s]+)/);
      if (m) state.flags[m[1].split('/').pop()] = '0';
      lines.push('');
    }

    // end marker
    if (cmd.includes('end=1')) lines.push('end=1');

    return { errno: 0, stdout: lines.join('\n'), stderr: '' };
  }

  // ---------- install mock ksu API ----------
  window.ksu = {
    exec(cmd, _payload, callbackName) {
      // simulate async shell delay
      setTimeout(() => {
        const result = run(cmd);
        if (typeof window[callbackName] === 'function') {
          window[callbackName](result.errno, result.stdout, result.stderr);
        }
      }, 300 + Math.random() * 300);
    }
  };

  // ---------- debug UI ----------
  function buildDebug() {
    const box = document.createElement('div');
    box.style.cssText = [
      'position:fixed; top:10px; right:10px; z-index:1000;',
      'background:rgba(0,0,0,.85); color:#fff; padding:12px; border-radius:10px;',
      'font:12px/1.4 ui-monospace, monospace; max-width:300px;',
      'box-shadow:0 8px 32px rgba(0,0,0,.4);'
    ].join('');

    const toggle = (label, key, path) => {
      const div = document.createElement('div');
      div.style.marginBottom = '8px';
      div.innerHTML = `
        <label style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; font-size:12px;">
          <span>${label}</span>
          <span id="dbg-${key}" style="padding:2px 8px; border-radius:4px; background:#444;">${state[path] || 'no'}</span>
        </label>`;
      div.querySelector('label').onclick = () => {
        const cur = state[path] === 'yes' || state[path] === '1';
        state[path] = cur ? 'no' : 'yes';
        div.querySelector(`#dbg-${key}`).textContent = state[path];
        div.querySelector(`#dbg-${key}`).style.background = state[path] === 'yes' || state[path] === '1' ? '#0f9d58' : '#444';
        // clear cache so next boot re-reads
        localStorage.removeItem('dsl_home_cache');
        localStorage.removeItem('dsl_diag_cache');
        location.reload();
      };
      return div;
    };

    const sel = (label, key, options) => {
      const div = document.createElement('div');
      div.style.marginBottom = '8px';
      div.innerHTML = `
        <div style="font-size:11px; opacity:.7; margin-bottom:2px;">${label}</div>
        <select id="dbg-sel-${key}" style="width:100%; font-size:12px;">
          ${options.map(([v, l]) => `<option value="${v}" ${state[key] === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>`;
      div.querySelector('select').onchange = (e) => {
        state[key] = e.target.value;
        localStorage.removeItem('dsl_home_cache');
        localStorage.removeItem('dsl_diag_cache');
        location.reload();
      };
      return div;
    };

    box.innerHTML = '<div style="font-weight:700; margin-bottom:8px; font-size:13px; border-bottom:1px solid #444; padding-bottom:4px;">🧪 Mock Device</div>';
    box.appendChild(toggle('mali0 present', 'mali0', 'mali0'));
    box.appendChild(toggle('render node', 'render', 'render'));
    box.appendChild(sel('Route', 'route', [['auto', 'Auto'], ['anland6', 'Anland 6.x'], ['desktop5', 'Desktop 5.x']]));
    box.appendChild(toggle('Modules loaded', 'modsLoaded', 'mods'));
    box.appendChild(toggle('MTK platform', 'mtk', 'mtk'));

    const reload = document.createElement('button');
    reload.textContent = 'Reload';
    reload.style.cssText = 'margin-top:8px; width:100%; padding:6px; font-size:12px; background:#0f9d58; color:#fff; border:none; border-radius:6px; cursor:pointer;';
    reload.onclick = () => location.reload();
    box.appendChild(reload);

    return box;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(buildDebug());
  });
})();
