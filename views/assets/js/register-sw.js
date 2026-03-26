(() => {
  const swRoutes = {
      uv: ['{{route}}{{/uv/sw.js}}', '{{route}}{{/uv/sw-blacklist.js}}'],
      sj: [
        '{{route}}{{/scram/scramjet.sw.js}}',
        '{{route}}{{/scram/scramjet.sw-blacklist.js}}'
      ],
    },
    swAllowedHostnames = ['localhost', '127.0.0.1'],
    wispUrl =
      (location.protocol === 'https:' ? 'wss' : 'ws') +
      '://' +
      location.host +
      '{{route}}{{/wisp/}}',
    wireproxyApi = '{{route}}{{/api/wireproxy}}',
    proxyUrl = {
      tor: 'socks5h://localhost:9050',
      eu: 'socks5h://localhost:7000',
      jp: 'socks5h://localhost:7001',
    },
    transports = {
      '{{epoxy}}': '{{route}}{{/epoxy/index.mjs}}',
      '{{libcurl}}': '{{route}}{{/libcurl/index.mjs}}',
    },
    storageId = '{{hu-lts}}-storage',
    storageObject = () => JSON.parse(localStorage.getItem(storageId)) || {},
    readStorage = (name) => storageObject()[name],
    defaultMode = '{{libcurl}}',
    isYoutubePresetPage = !!document.getElementById('pr-iv'),
    socks5StorageKey = isYoutubePresetPage ? 'UseSocks5Youtube' : 'UseSocks5';

  transports.default = transports[defaultMode];

  Object.freeze(transports);

  const readWireproxyConfig = async () => {
    try {
      const response = await fetch(wireproxyApi, { cache: 'no-store' });
      if (!response.ok) return { enabled: false, proxy: '' };
      const wireproxyConfig = await response.json();
      return {
        enabled: wireproxyConfig && wireproxyConfig.enabled === true,
        proxy:
          wireproxyConfig && 'string' === typeof wireproxyConfig.proxy
            ? wireproxyConfig.proxy
            : '',
      };
    } catch (err) {
      console.warn('Wireproxy config request failed:', err);
      return { enabled: false, proxy: '' };
    }
  };

  const registerSW = async () => {
    if (!navigator.serviceWorker) {
      if (
        location.protocol !== 'https:' &&
        !swAllowedHostnames.includes(location.hostname)
      )
        throw new Error('Service workers cannot be registered without https.');

      throw new Error("Your browser doesn't support service workers.");
    }

    // Set the transport mode
    const transportMode =
        transports[readStorage('Transport')] || transports.default,
      wireproxyConfig = await readWireproxyConfig();
    const selectedProxy = readStorage(socks5StorageKey);
    const useWireProxy = readStorage('UseWireProxy') !== false;
    let transportOptions = { wisp: wispUrl };

    // Socks5 proxy options
    if ('string' === typeof selectedProxy && proxyUrl[selectedProxy])
      transportOptions.proxy = proxyUrl[selectedProxy];
    else if (useWireProxy && wireproxyConfig.enabled && wireproxyConfig.proxy)
      transportOptions.proxy = wireproxyConfig.proxy;

    console.log('Using proxy:', transportOptions.proxy);
    console.log('Transport mode:', transportMode);

    const connection = new BareMux.BareMuxConnection('{{route}}{{/baremux/worker.js}}');
    await connection.setTransport(transportMode, [transportOptions]);

    const registrations = await navigator.serviceWorker.getRegistrations(),
      usedSW = swRoutes.uv[readStorage('HideAds') !== false ? 1 : 0];

    console.log('Service Worker being registered:', usedSW);

    // Unregister outdated service workers
    for (const registration of registrations)
      if (
        registration.active &&
        new URL(registration.active.scriptURL).pathname !==
          new URL(usedSW, location.origin).pathname
      )
        await registration.unregister();

    await navigator.serviceWorker.register(usedSW);
  };

  const initializeScramjet = async () => {
    try {
      const { ScramjetController } = await $scramjetLoadController();

      const scramjet = new ScramjetController({
        prefix: '{{route}}{{/scram/network/}}',
        files: {
          wasm: '{{route}}{{/scram/scramjet.wasm.wasm}}',
          all: '{{route}}{{/scram/scramjet.all.js}}',
          sync: '{{route}}{{/scram/scramjet.sync.js}}',
        },
        flags: {
          rewriterLogs: false,
          naiiveRewriter: false,
          scramitize: false,
        },
      });

      console.log('Initializing ScramjetController');
      scramjet.init();
      navigator.serviceWorker.register(
        swRoutes.sj[readStorage('HideAds') !== false ? 1 : 0]
      );
    } catch (err) {
      console.error('Scramjet initialization failed:', err);
    }
  };

  const initialize = async () => {
    try {
      await registerSW();

      await initializeScramjet();
    } catch (err) {
      console.error('Initialization failed:', err);
    }
  };

  initialize();
})();
