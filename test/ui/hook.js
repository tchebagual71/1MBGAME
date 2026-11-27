// test hook: expose module namespaces (harness only); getter so RUN (defined later in main) resolves lazily
Object.defineProperty(window, '__T', { get: () => ({ UI, GFX, FX, AU, GAME, DIR, POST, SCENE, S, LIVE, PATCH, IN, BUS, ENT, RUN, SELF, fb }) });
