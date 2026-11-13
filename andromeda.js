(async () => {
const demoMode = false;
const scramjetEnabled = true;
const defaultService = "scramjet";

const currentScript = document.currentScript;

window.andromeda = {
  loaded: false,
  demoMode,
  frames: {},
  transport:
    localStorage.getItem("@andromeda/transport") ||
    currentScript.dataset.transport ||
    "libcurl",
  wisp:
    localStorage.getItem("@andromeda/wisp") ||
    currentScript.dataset.wisp ||
    (location.protocol === "https:" ? "wss" : "ws") +
      "://" +
      location.host +
      "/wisp/",
};

async function encodeService(url) {
  if (scramjetEnabled && andromeda.scramjet) {
    return window.location.origin + andromeda.scramjet.prefix + andromeda.scramjet.config.codec.encode(url);
  }
  return url;
}

window.andromeda.encode = async function (url, config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    config = {
      service: defaultService,
      autoHttps: false,
    };
  }

  if (config.service === undefined) {
    config.service = defaultService;
  }

  if (config.autoHttps === undefined) {
    config.autoHttps = false;
  }

  if (demoMode) {
    return "/andromeda.demo.html";
  }

  if (url.match(/^https?:\/\//)) {
    return await encodeService(url);
  } else if (
    config.autoHttps === true &&
    url.includes(".") &&
    !url.includes(" ")
  ) {
    return await encodeService("https://" + url);
  } else if (config.searchEngine) {
    return await encodeService(
      config.searchEngine.replace("%s", encodeURIComponent(url)),
    );
  } else {
    return await encodeService(url);
  }
};

window.andromeda.decode = async function (url) {
  if (scramjetEnabled && andromeda.scramjet) {
    return andromeda.scramjet.config.codec.decode(
      url.split(andromeda.scramjet.prefix)[1]
    );
  }
};

window.andromeda.navigate = async function (frameId, url) {
  if (!andromeda.scramjet) throw new Error("Controller not initialized");
  const el = document.getElementById(frameId);
  if (!el) throw new Error("Frame element not found: " + frameId);
  let frame = andromeda.frames[frameId];
  if (!frame) {
    frame = andromeda.scramjet.createFrame(el);
    andromeda.frames[frameId] = frame;
  }
  if (!url.match(/^https?:\/\//)) {
    url = "https://" + url;
  }
  await frame.go(url);
  el.dataset.open = "true";
};

window.andromeda.setStore = function (key, value) {
  const allowed = [
    "transport",
    "wisp",
    "service",
    "autoHttps",
    "searchEngine",
    "title",
    "icon",
  ];

  if (allowed.includes(key)) {
    localStorage.setItem("@andromeda/" + key, String(value));
    if (key === "transport") {
      window.andromeda.setTransport(value);
    }
    if (key === "wisp") {
      window.andromeda.setWisp(value);
    }
    if (key === "title") {
      const titleElement = document.querySelector("title[is='andromeda-title']");

      if (titleElement) {
        titleElement.innerText =
          value || titleElement.getAttribute("data-title");
      }
    }
    if (key === "icon") {
      const iconElement = document.querySelector("link[is='andromeda-icon']");

      if (iconElement) {
        iconElement.setAttribute(
          "href",
          value || iconElement.getAttribute("data-icon"),
        );
      }
    }
    window.dispatchEvent(
      new CustomEvent("andromedaStoreChange", {
        detail: { key, value },
      }),
    );
  }
};

window.andromeda.getStore = function (key) {
  const value =
    key === "autoHttps"
      ? localStorage.getItem("@andromeda/" + key) === "true"
      : localStorage.getItem("@andromeda/" + key);

  const defaults = {
    transport: window.andromeda.transport,
    wisp: window.andromeda.wisp,
    service: "scramjet",
    autoHttps: false,
    title: document.querySelector("title[is='andromeda-title']")?.innerText,
    icon: document
      .querySelector("link[is='andromeda-icon']")
      ?.getAttribute("href"),
  };

  return value || defaults[key];
};

window.andromeda.setTransport = async function (newTransport) {
  newTransport = newTransport || currentScript.dataset.transport || "libcurl";
  if (!andromeda.scramjet) return;
  const transport = await createTransport(newTransport, andromeda.wisp);
  andromeda.scramjet.setTransport(transport);
  andromeda.transport = newTransport;
};

window.andromeda.getSuggestions = async function (query) {
  if (!query) return [];
  try {
    const encoded = await window.andromeda.encode(
      "https://duckduckgo.com/ac/?q=" + encodeURIComponent(query) + "&type=list",
    );
    const response = await fetch(encoded);
    const suggestions = await response.json();
    return suggestions[1].slice(0, 9);
  } catch {
    return [];
  }
};

window.andromeda.createDataURL = async function (url) {
  return new Promise(async (resolve) => {
    try {
      const encoded = await window.andromeda.encode(url);
      const response = await fetch(encoded);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = function () {
        resolve(reader.result);
      };
      reader.readAsDataURL(blob);
    } catch {
      resolve(undefined);
    }
  });
};

window.andromeda.setWisp = async function (wisp) {
  wisp =
    wisp ||
    currentScript.dataset.wisp ||
    (location.protocol === "https:" ? "wss" : "ws") +
      "://" +
      location.host +
      "/wisp/";
  if (!andromeda.scramjet) return;
  const transport = await createTransport(andromeda.transport, wisp);
  andromeda.scramjet.setTransport(transport);
  andromeda.wisp = wisp;
};

async function createTransport(name, wisp) {
  const mod =
    name === "epoxy"
      ? await import("/epoxy/index.mjs")
      : await import("/libcurl/index.mjs");
  return new mod.default({ wisp });
}

async function loadScript(src) {
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      reject();
    };
    document.head.appendChild(script);
  });
}

async function initScramjet() {
  await loadScript("/scram/scramjet.js");
  await loadScript("/controller/controller.api.js");

  const registration = await navigator.serviceWorker.register(
    "/andromeda.sw.js",
    { type: "classic", updateViaCache: "none" },
  );
  await navigator.serviceWorker.ready;
  const sw = navigator.serviceWorker.controller ?? registration.active;
  if (!sw) throw new Error("No service worker available");

  const { Controller } = $scramjetController;

  // Configure paths to match server serving (reference bootstrap pattern)
  $scramjetController.config.scramjetPath = "/scram/scramjet.js";
  $scramjetController.config.wasmPath = "/scram/scramjet.wasm";
  $scramjetController.config.injectPath = "/controller/controller.inject.js";

  const transport = await createTransport(andromeda.transport, andromeda.wisp);

  andromeda.scramjet = new Controller({
    serviceworker: sw,
    transport,
  });
  await andromeda.scramjet.wait();

  // Initialize frames for existing andromeda iframes (reference pattern)
  document.querySelectorAll('iframe[is="andromeda-iframe"]').forEach((el) => {
    const frame = andromeda.scramjet.createFrame(el);
    andromeda.frames[el.id] = frame;
  });
}

if (scramjetEnabled) {
  await initScramjet();
}
window.andromeda.loaded = true;
window.dispatchEvent(new Event("andromedaLoaded"));

})();