(function () {
  "use strict";


  function sendMessageWorker(el, messageHandler, message) {
    return new Promise((resolve, reject) => {

      if (!messageHandler) {
        reject();
      }
      messageHandler.postMessage(message);

      messageHandler.addEventListener('message', m => {
        resolve(m.data);
      });
    });
  }

  function sendMessageNoWorker(el, messageHandler, message) {
    const core = el.getAttribute("using");
    if (window[core]) {
      try {
        return messageHandler({ data: message });
      } catch (error) {
        console.log(error.message);
      }
    }
  }

  function sendMessage(el, messageHandler, message) {
    return el.getAttribute("use-worker") == "" ? sendMessageWorker(el, messageHandler, message) : sendMessageNoWorker(el, messageHandler, message);
  }

  function properties(el, messageHandler, props) {
    const message = {
      event: "get_properties",
      properties: props
    };

    return sendMessage(el, messageHandler, message);
  }

  async function convertWithCanvas(el, messageHandler, format, blob) {
    const res = blob;
    const props = await properties(el, messageHandler, ["width", "height"]);

    if (el.getAttribute("noCleanupOnExit") == null) {
      const message = {
        event: "destroy"
      };

      sendMessage(el, messageHandler, message);
    }

    const canvas = new OffscreenCanvas(props.width, props.height);
    const data = new Uint8ClampedArray(await blob.arrayBuffer());
    const ctx = canvas.getContext('2d');
    let imgData;
    switch (format) {
      case "rgba":
        imgData = new ImageData(data, props.width, props.height);
        ctx.putImageData(imgData, 0, 0);
        return await canvas.convertToBlob();
      case "rgb":
        imgData = new ImageData(props.width, props.height);
        const dest = imgData.data;
        const n = 4 * props.width * props.height;
        let s = 0, d = 0;
        while (d < n) {
          dest[d++] = data[s++];
          dest[d++] = data[s++];
          dest[d++] = data[s++];
          dest[d++] = 255;    // skip alpha byte
        }

        ctx.putImageData(imgData, 0, 0);

        return await canvas.convertToBlob();
    }
  }

  async function dataURLToSrc(el, messageHandler, blob, out) {
    if (!blob) return;

    if (out == "rgb" || out == "rgba") {
      blob = await convertWithCanvas(el, messageHandler, out, blob);
    }

    return URL.createObjectURL(blob);
  }

  async function processMessages(el, res, messageHandler, out) {
    function clear_text(text) {
      return text
        .replaceAll("[37m", '')
        .replaceAll("[0m", '');
    }
    const print = el.getAttribute("print");
    if (res.print) {
      if (print) {
        print.value += clear_text(res.print) + "\n";
      } else {
        console.log(res.print);
      }
    }

    const printerr = el.getAttribute("printerr");
    if (res.printErr) {
      if (printerr) {
        printerr.value += clear_text(res.printErr) + "\n";
      } else {
        console.log(res.printErr);
      }
    }

    if ("exit_code" in res) {
      if (res.blob) {
        const src = await dataURLToSrc(el, messageHandler, res.blob, out);
        if (el instanceof HTMLImageElement || el instanceof HTMLPictureElement)
          el.setAttribute("srcset", src);
        else if (el instanceof HTMLAudioElement|| el instanceof HTMLVideoElement)
          el.setAttribute("src", src);
      }
    }

  }

  function launchNoWorker(el, out, script, message) {
    const core = el.getAttribute("using");
    function addLoadEvent(script, func) {
      var oldonload = script.onload;
      if (typeof script.onload != 'function') {
        script.onload = func;
      } else {
        script.onload = function () {
          if (oldonload) {
            oldonload();
          }
          func();
        };
      }
    }

    async function init() {
      const elt = this;
      const core = elt.getAttribute("using");
      const messageHandlerNoWorker = await window[core]();
      const res = await messageHandlerNoWorker({ data: message });
      processMessages(el, res, messageHandlerNoWorker, out);
    }

    const scripts = document.querySelectorAll(`script[src$="${script}"]`);
    const bind_init = init.bind(el);

    if (scripts.length > 0) {
      const coreInit = window[core];
      if (coreInit) {
        init();
      } else {
        addLoadEvent(scripts[0], bind_init);
      }
    } else {
      const script_elt = document.createElement('script');
      script_elt.src = script;
      addLoadEvent(script_elt, bind_init);
      document.head.appendChild(script_elt);
      this.script = script_elt;
    }
  }

  function launchWorker(el, script, out, message) {
    const worker = new Worker(script);
    if (worker) {
      worker.postMessage(message);

      worker.addEventListener('message', m => {
        processMessages(el, m.data, worker, out);
      });
    }
  }

  async function test_url(directories, url) {
    const filter_directories = directories.filter(x => x != "");

    for (const directory of filter_directories) {
      if (await urlExist(directory + url)) {
        return directory + url;
      }

      return "";
    }

    return url;
  }

  function addScriptDirectoryAndExtIfNeeded(scriptDirectory, url, ext) {
    try {
      const parsed_url = new URL(url);
      if (parsed_url.protocol === 'blob:') {
        return url;
      } else if (parsed_url.protocol === 'http:' || parsed_url.protocol === 'https:') {
        return test_url([], url + ext);
      }

      return test_url(scriptDirectory.split(';'), url + ext);
    } catch (e) {
      return test_url(scriptDirectory.split(';'), url + ext);
    }
  }

  async function universal_decode(el) {
    let js = null;
    let wasmBinaryFile = null;
    let dynamicLibraries = [];


    const scriptDirectory = el.getAttribute("script-directory") ? el.getAttribute("script-directory") : "";

    if (el.getAttribute("using")) {
      js = await addScriptDirectoryAndExtIfNeeded(scriptDirectory, el.getAttribute("using"), ".js");
      wasmBinaryFile = await addScriptDirectoryAndExtIfNeeded(scriptDirectory, el.getAttribute("using"), ".wasm");
    }

    if (el.getAttribute("js")) {
      //Overwrite js attribute
      js = await addScriptDirectoryAndExtIfNeeded(scriptDirectory, el.getAttribute("js"), "");
    }

    if (el.getAttribute("with")) {
      const all_using = await Promise.all(el.getAttribute("with").split(';').map(x => addScriptDirectoryAndExtIfNeeded(scriptDirectory, x, ".wasm")));
      dynamicLibraries = dynamicLibraries.concat(all_using);
    }

    // Set source
    let src = el.getAttribute("src");
    if (el instanceof HTMLCanvasElement){
      src = el.getAttribute("data-url"); // canvas is using a special attribute since its not standard
      el.setAttribute("id", "canvas"); //FIXME : This is only for the demo
    }
      


    // Set output format
    let out = el.getAttribute("out");
    if (!out) {
      if (el instanceof HTMLImageElement || el instanceof HTMLPictureElement)
        out = "rgb";
      else if (el instanceof HTMLAudioElement)
        out = "wav";
      else if (el instanceof HTMLVideoElement)
        out = "mp4";
    }

    const message = {
      event: "init",
      module: {
        dynamicLibraries: dynamicLibraries,
        noInitialRun: true,
        noExitRuntime: true,
        canvas: el instanceof HTMLCanvasElement ? el : null
      },
      wasmBinaryFile: wasmBinaryFile,
      src: src,
      dst: el instanceof HTMLCanvasElement ? null : "out." + out,
      useWebcodec: false,
      showStats: el.getAttribute("stats"),
      showGraph: el.getAttribute("graph"),
      showReport: el.getAttribute("report"),
      showLogs: el.getAttribute("logs"),
      get: el.out == "rgb" || el.out == "rgba" ? ["width", "height"] : [],
      print: el.getAttribute("print"),
      printErr: el.getAttribute("printErr"),
      noCleanupOnExit: el.getAttribute("noCleanupOnExit") || el.out == "rgb" || el.out == "rgba",
      loop: el instanceof HTMLCanvasElement ? el.getAttribute("noloop") == "" ? false : true : null,
      width: el.getAttribute("width"),
      height: el.getAttribute("height"),
      vbench: el instanceof HTMLCanvasElement ? el.getAttribute("vbench") : null
    };


    if (!js) {
      console.log("Warning! no accessor is used on the universal, using a usual tag instead...");
      return;
    }
    try {
      el.getAttribute("use-worker") == "" ? launchWorker(el, js, out, message) : launchNoWorker(el, out, js, message);
    } catch (e) {
      return;
    }
  }


  new MutationObserver(mutations => mutations.forEach(mutation => mutation.addedNodes.forEach(el => {
    if (el instanceof HTMLImageElement || el instanceof HTMLPictureElement || el instanceof HTMLAudioElement || el instanceof HTMLVideoElement || el instanceof HTMLCanvasElement)
      universal_decode(el);
  }))).observe(document.documentElement, { subtree: true, childList: true });
}());
