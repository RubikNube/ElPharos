import base64, json, os, subprocess, time, urllib.request, urllib.error
from pathlib import Path
import tempfile, socket
root = str(Path(__file__).resolve().parents[1])
save_dir = tempfile.TemporaryDirectory(prefix='el-pharos-browser-')
os.environ['EL_PHAROS_SAVE_PATH'] = save_dir.name + '/save.json'
processes = []

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

server_port, web_port, driver_port = free_port(), free_port(), free_port()
os.environ['EL_PHAROS_BIND'] = f'127.0.0.1:{server_port}'
config_path = Path(save_dir.name) / 'vite.config.mjs'
config_path.write_text(
    'import base from ' + json.dumps(root + '/apps/web/vite.config.ts') + ';\n'
    + 'export default {...base, server: {...base.server, proxy: {'
    + "'/ws': {target: 'ws://127.0.0.1:" + str(server_port) + "', ws: true},"
    + "'/health': {target: 'http://127.0.0.1:" + str(server_port) + "'}}}};\n"
)

def req(method, path, data=None):
    body = None if data is None else json.dumps(data).encode()
    request = urllib.request.Request(f'http://127.0.0.1:{driver_port}' + path, body, {'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    value = result.get('value')
    if isinstance(value, dict) and 'error' in value: raise RuntimeError(value)
    return value

def wait_url(url):
    for _ in range(100):
        try:
            urllib.request.urlopen(url, timeout=1).close()
            return
        except (OSError, urllib.error.URLError): time.sleep(.1)
    raise RuntimeError('Not ready: ' + url)

try:
    for name, command in [('server', ['cargo', 'run', '--quiet', '-p', 'el-pharos-server']), ('web', ['npm', 'exec', '--workspace', '@el-pharos/web', '--', 'vite', '--host', '127.0.0.1', '--config', str(config_path), '--port', str(web_port)]), ('driver', ['chromedriver', f'--port={driver_port}'])]:
        log = open('/tmp/el-pharos-' + name + '.log', 'w')
        processes.append(subprocess.Popen(command, cwd=root, stdout=log, stderr=log, start_new_session=True))
    wait_url(f'http://127.0.0.1:{server_port}/health')
    wait_url(f'http://127.0.0.1:{web_port}')
    wait_url(f'http://127.0.0.1:{driver_port}/status')
    session = req('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'chrome', 'goog:chromeOptions': {'binary': '/usr/bin/chromium', 'args': ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--window-size=1440,1000']}, 'goog:loggingPrefs': {'browser': 'ALL'}}}})['sessionId']
    route = '/session/' + session
    def js(script): return req('POST', route + '/execute/sync', {'script': script, 'args': []})
    def screenshot(name):
        data = req('GET', route + '/screenshot')
        Path('/tmp/el-pharos-' + name + '.png').write_bytes(base64.b64decode(data))
        return data
    req('POST', route + '/url', {'url': f'http://127.0.0.1:{web_port}'})
    for _ in range(100):
        if js("return document.body.innerText.includes('World connected') && !!document.querySelector('canvas')"): break
        time.sleep(.1)
    else: raise RuntimeError(js('return document.body.innerText'))
    time.sleep(1)
    assert js("return document.querySelectorAll('canvas').length") == 1
    assert js("return document.body.innerText.includes('First Haven') && document.body.innerText.includes('Beacon illuminated')")
    assert js("return document.querySelector('.resource.fuel').innerText.includes('Fuel:')")
    assert js("return document.querySelector('header [aria-label=\"Resources\"]') !== null && !document.querySelector('aside [aria-label=\"Fuel economy\"]')")
    js("document.querySelector('.pause').click()")
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Simulation paused')")
    frozen = js("return document.querySelector('.resource.fuel h3').innerText")
    time.sleep(1.2)
    assert js("return document.querySelector('.resource.fuel h3').innerText") == frozen
    js("document.querySelector('.pause').click()")
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Simulation running')")
    assert js("return document.body.innerText.includes('Salvage: 100 / 300')")
    js("document.querySelector('.save-controls button').click()")
    time.sleep(.2)
    pristine = Path(os.environ['EL_PHAROS_SAVE_PATH']).read_text()
    generated = json.loads(pristine)['world']
    assert 6 <= len(generated['islands']) <= 12
    assert len(generated['lighthouses']) == len(generated['islands'])
    pristine = json.dumps({'save_version': 7, 'world': json.loads((Path(root) / 'tests/fixtures/fixed-world.json').read_text())})
    Path(os.environ['EL_PHAROS_SAVE_PATH']).write_text(pristine)
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.2)
    js("document.querySelector('.pause').click()")
    time.sleep(.2)
    specialization = '[aria-label="Lighthouse specialization"]'
    js(f"document.querySelector({json.dumps(specialization + ' button')}).click()")
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Beacon upkeep: 0.5 fuel/s')")
    assert js("return document.body.innerText.includes('Salvage: 60 / 300')")
    assert js("return document.querySelector('.upgrade-preview').innerText.includes('0.75 fuel/s')")
    js("document.querySelector('.save-controls button').click()")
    time.sleep(.2)
    js(f"document.querySelectorAll({json.dumps(specialization + ' button')})[1].click()")
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Installed: Navigation beacon')")
    assert js("return document.body.innerText.includes('Salvage: 40 / 300')")
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Installed: Efficient lamp')")
    screenshot('specialization')
    Path(os.environ['EL_PHAROS_SAVE_PATH']).write_text(pristine)
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.2)

    # Reveal an archive through real expansion, purchase using the keyboard, and round-trip research.
    research_fixture = json.loads(pristine)
    research_fixture['world']['economy']['paused'] = True
    research_fixture['world']['salvage']['reserve'] = 160
    research_fixture['world']['lighthouses'][0].update(radius=470, explored_radius=470)
    Path(os.environ['EL_PHAROS_SAVE_PATH']).write_text(json.dumps(research_fixture))
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.2)
    assert js("return document.querySelectorAll('[aria-label=\"Research\"] .archive h3').length") == 3
    assert js("return Array.from(document.querySelectorAll('[aria-label=\"Research\"] .archive h3')).every(h => h.textContent === 'Uncharted archive')")
    js("document.querySelector('[aria-label=\"Research\"] summary').focus()")
    def press_enter():
        req('POST', route + '/actions', {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': [{'type': 'keyDown', 'value': '\ue007'}, {'type': 'keyUp', 'value': '\ue007'}]}]})
    press_enter()
    assert js("return document.querySelector('[aria-label=\"Research\"] details').open")
    js("document.querySelector('.expand').click()")
    time.sleep(.2)
    assert js("return document.querySelector('[aria-label=\"Research\"] .archive h3').innerText === 'Amber Shoal archive'")
    assert js("return document.querySelector('.objective').innerText.includes('1/3 archives discovered')")
    assert js("return document.querySelector('[data-technology=modular_fittings] button').disabled")
    js("document.querySelector('[data-technology=reinforced_foundations] button').focus()")
    press_enter()
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Salvage: 100 / 300')")
    assert js("return document.querySelector('.expand').innerText.includes('15 Salvage')")
    js("document.querySelector('[data-technology=modular_fittings] button').click()")
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Salvage: 20 / 300')")
    assert js("return document.querySelector('[aria-label=\"Lighthouse specialization\"] button').innerText.includes('30 Salvage')")
    js("document.querySelector('.save-controls button').click()")
    time.sleep(.2)
    research_saved = Path(os.environ['EL_PHAROS_SAVE_PATH']).read_text()
    Path(os.environ['EL_PHAROS_SAVE_PATH']).write_text(pristine)
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.2)
    Path(os.environ['EL_PHAROS_SAVE_PATH']).write_text(research_saved)
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.2)
    assert js("return document.querySelector('.objective').innerText.includes('2/6 technologies researched')")
    assert js("return document.querySelector('[data-technology=reinforced_foundations] button').innerText.includes('Researched:')")
    req('POST', route + '/window/rect', {'width': 390, 'height': 844})
    time.sleep(.2)
    assert js('return document.documentElement.scrollWidth <= window.innerWidth')
    js("document.querySelector('[aria-label=\"Research\"] summary').scrollIntoView({block: 'start'})")
    screenshot('research-mobile')
    req('POST', route + '/window/rect', {'width': 1440, 'height': 1000})
    js("document.querySelector('[aria-label=\"Research\"] summary').click()")
    Path(os.environ['EL_PHAROS_SAVE_PATH']).write_text(pristine)
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.2)

    js("Array.from(document.querySelectorAll('nav button')).find(b => b.innerText.includes('Wreckers')).click()")
    assert js("return document.querySelector('[aria-label=\"Salvage yard\"]').innerText.includes('120 fuel + 40 Salvage')")
    js("document.querySelector('[aria-label=\"Salvage yard\"] button').click()")
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Salvage: 60 / 300')")
    js("document.querySelector('.primary').click()")
    for _ in range(150):
        if js("return document.querySelector('[aria-label=\"Salvage yard\"]').innerText.includes('Delivering to Haven')"): break
        time.sleep(.1)
    else: raise RuntimeError('No authoritative cargo delivery')
    screenshot('cargo-delivery')
    for _ in range(150):
        if js("return document.body.innerText.includes('1/2 yards have delivered cargo')"): break
        time.sleep(.1)
    else: raise RuntimeError('Cargo never arrived')
    Path(os.environ['EL_PHAROS_SAVE_PATH']).write_text(pristine)
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.3)
    js("document.querySelectorAll('nav button')[0].click()")
    initial = screenshot('lit')
    js("document.querySelector('.primary').click()")
    time.sleep(.3)
    assert js("return document.body.innerText.includes('Beacon extinguished')")
    dark = screenshot('dark')
    assert dark != initial
    js("document.querySelector('.primary').click()")
    time.sleep(.3)
    assert js("return document.querySelectorAll('nav button').length") == 3
    assert js("return document.querySelector('.upgrade-preview').innerText.includes('1.25 fuel/s')")
    js("document.querySelector('.expand').click()")
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Beacon upkeep: 1.25 fuel/s')")
    assert js("return document.querySelector('.upgrade-preview').innerText.includes('1.5 fuel/s')")
    for _ in range(30):
        if js("return !Number.isInteger(Number(document.querySelector('.resource.fuel h3').innerText.split(' ')[1]))"): break
        time.sleep(.1)
    else: raise RuntimeError('Fractional fuel was not displayed')
    for _ in range(3):
        js("document.querySelector('.expand').click()")
        time.sleep(.15)
    assert js("return document.querySelectorAll('nav button').length") == 4
    js("document.querySelectorAll('nav button')[1].click()")
    assert js("return document.querySelector('h2').innerText.includes('Amber Shoal')")
    js("document.querySelector('.primary').click()")
    time.sleep(.2)
    assert js("return document.body.innerText.includes('Beacon illuminated')")
    assert js("return document.querySelector('.fuel-facility').innerText.includes('Ruined')")
    assert js("return !document.querySelector('.fuel-facility button').disabled")
    js("document.querySelector('.fuel-facility button').click()")
    time.sleep(.2)
    assert js("return document.querySelector('.fuel-facility').innerText.includes('Operational · +3 fuel/s')")
    assert js("return document.querySelector('.resource.fuel').title.includes('Production: +5/s')")
    js("document.querySelector('.save-controls button').click()")
    time.sleep(.3)
    assert js("return document.body.innerText.includes('World saved.')")
    js("document.querySelector('.expand').click()")
    time.sleep(.2)
    assert js("return document.querySelector('dl').innerText.includes('350 units')")
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.3)
    assert js("return document.body.innerText.includes('World loaded.') && document.querySelector('dl').innerText.includes('290 units')")
    assert js("return document.querySelector('.fuel-facility').innerText.includes('Operational · +3 fuel/s')")
    # Extinguishing preserves discovered entries.
    js("document.querySelector('.primary').click()")
    time.sleep(.2)
    assert js("return document.querySelectorAll('nav button').length") == 4
    assert js("return document.querySelector('.fuel-facility').innerText.includes('Isolated · +0 fuel/s')")
    assert js("return document.querySelector('.resource.fuel').title.includes('Production: +2/s')")
    before = screenshot('before-pan')
    req('POST', route + '/actions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerMove', 'duration': 0, 'x': 500, 'y': 400}, {'type': 'pointerDown', 'button': 0}, {'type': 'pointerMove', 'duration': 200, 'x': 650, 'y': 450}, {'type': 'pointerUp', 'button': 0}]}]})
    assert screenshot('panned') != before
    assert js("return document.querySelector('h2').innerText.includes('Amber Shoal')")
    req('POST', route + '/actions', {'actions': [{'type': 'wheel', 'id': 'wheel', 'actions': [{'type': 'scroll', 'x': 600, 'y': 400, 'deltaX': 0, 'deltaY': -350, 'duration': 200}]}]})
    screenshot('zoomed')
    js("document.querySelector('.map-controls button:nth-child(2)').click()")
    time.sleep(.2)
    screenshot('reset')
    req('POST', route + '/window/rect', {'width': 390, 'height': 844})
    time.sleep(.3)
    assert js('return document.documentElement.scrollWidth <= window.innerWidth')
    screenshot('mobile')
    req('POST', route + '/window/rect', {'width': 1440, 'height': 1000})
    time.sleep(.2)
    js("document.querySelector('.map-controls button:nth-child(2)').click()")
    # Hit the first lighthouse using fit-to-world geometry read from the canvas host.
    coords = js("const r=document.querySelector('.map').getBoundingClientRect(); const z=Math.max(.15, Math.min(4, Math.min(r.width/2400,r.height/1000)*.9)); return [r.x+r.width/2+(800-1200)*z,r.y+r.height/2+(480-500)*z]")
    req('POST', route + '/actions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type':'pointerMove','duration':0,'x':round(coords[0]),'y':round(coords[1])},{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]}]})
    assert js("return document.querySelector('h2').innerText === 'First Light'")
    # Load a low-fuel fixture through the real save slot to exercise blackout and recovery.
    fixture = json.loads(Path(os.environ['EL_PHAROS_SAVE_PATH']).read_text())
    fixture['world']['economy'].update(fuel=0, paused=False, blackout=False)
    fixture['world']['islands'][1]['fuel_facility'] = 'ruined'
    for light in fixture['world']['lighthouses']:
        light['active'] = True
        light['explored_radius'] = light['radius']
    Path(os.environ['EL_PHAROS_SAVE_PATH']).write_text(json.dumps(fixture))
    js("document.querySelectorAll('.save-controls button')[1].click()")
    for _ in range(50):
        if js("return document.body.innerText.includes('Fuel shortage extinguished every beacon')"): break
        time.sleep(.1)
    else: raise RuntimeError('No blackout feedback')
    assert js("return document.body.innerText.includes('Beacon extinguished')")
    for _ in range(50):
        if js("return !document.querySelector('.primary').disabled"): break
        time.sleep(.1)
    else: raise RuntimeError('Fuel did not recover')
    js("document.querySelector('.primary').click()")
    time.sleep(.3)
    assert js("return document.body.innerText.includes('Beacon illuminated') && !document.body.innerText.includes('Fuel shortage extinguished every beacon')")
    # Old saves retain the original scenario and free radius expansion.
    fixture['save_version'] = 4
    fixture['world'].pop('salvage', None)
    fixture['world']['islands'] = fixture['world']['islands'][:4]
    fixture['world']['lighthouses'] = fixture['world']['lighthouses'][:4]
    # Complete the scenario through gameplay controls from a fresh paused world.
    fixture['world']['economy'].update(fuel=300, paused=True, blackout=False)
    for island in fixture['world']['islands'][1:]:
        island['fuel_facility'] = 'ruined'
    for i, light in enumerate(fixture['world']['lighthouses']):
        light.update(active=i == 0, radius=290, explored_radius=290 if i == 0 else 0)
    Path(os.environ['EL_PHAROS_SAVE_PATH']).write_text(json.dumps(fixture))
    js("document.querySelectorAll('.save-controls button')[1].click()")
    time.sleep(.3)
    print("Starting scenario playthrough", flush=True)
    for target in range(1, 4):
        for _ in range(4):
            js("document.querySelector('.expand').click()")
            time.sleep(.1)
        js(f"document.querySelectorAll('nav button')[{target}].click()")
        js("document.querySelector('.primary').click()")
        time.sleep(.15)
        print(f"Restoring island {target + 1}: " + js("return document.querySelector('.resource.fuel').innerText"), flush=True)
        # Earn enough for the third restoration using the actual simulation.
        js("if(document.querySelector('.fuel-facility button').disabled) document.querySelector('.pause').click()")
        for _ in range(900):
            if js("return !document.querySelector('.fuel-facility button').disabled"): break
            time.sleep(.1)
        else: raise RuntimeError('Restoration remained unaffordable')
        js("document.querySelector('.fuel-facility button').click()")
        time.sleep(.15)
    assert js("return document.querySelector('.objective h3').innerText === 'Archipelago restored'")
    assert js("return document.querySelector('.resource.fuel').title.includes('Production: +11/s')")
    screenshot('complete-network')
    # Losing and restoring the anchor updates the objective and production.
    js("document.querySelectorAll('nav button')[0].click()")
    time.sleep(.15)
    js("document.querySelector('.primary').click()")
    time.sleep(.2)
    assert js("return document.querySelector('.objective h3').innerText === 'Reconnect the archipelago'")
    assert js("return document.querySelector('.resource.fuel').title.includes('Production: +2/s')")
    js("document.querySelector('.primary').click()")
    time.sleep(.2)
    assert js("return document.querySelector('.objective h3').innerText === 'Archipelago restored'")
    logs = req('POST', route + '/log', {'type': 'browser'})
    severe = [entry for entry in logs if entry['level'] == 'SEVERE' and 'favicon.ico' not in entry['message']]
    assert not severe, severe
    print(json.dumps({'canvas': 'one canvas under React StrictMode', 'beacon': 'on/off round trip passed', 'camera': 'drag, wheel, reset exercised', 'mobile': 'no horizontal overflow', 'browser_errors': severe, 'screenshots': '/tmp/el-pharos-{lit,dark,panned,zoomed,reset,mobile}.png'}))
    req('DELETE', route)
finally:
    save_dir.cleanup()
    import signal
    for process in reversed(processes):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL)
