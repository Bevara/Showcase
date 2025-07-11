// Note: in serviceworker environnement the global object is called self (not window) 

importScripts('mp4box.all.js');

// Set the callback for the install step
self.addEventListener('install', function(event) {
	console.log("[mp4box-sw] Installed");
});

self.addEventListener('activate', function(event) {
	console.log("[mp4box-sw] activated");
});

function createResponse(type, data) {
	console.log("[mp4box-sw] Creating response of type "+type);
	const init = { status: 200 };
	const response = new Response(data,init);
	// the response already has a content-type = text/plain, we need to remove it and replace it with svg
	response.headers.delete('Content-Type');
	response.headers.append('Content-Type', type);
	const r = response.clone();
	console.log("[mp4box-sw] Response: ", response);
	if (response.headers.forEach) {
		response.headers.forEach(function(value, key) {
			console.log("[mp4box-sw]    "+key +": "+value);
		});
	}
	return r;	
}

/* Cache of MP4Box instances by URL */
const urlToMP4Box = [];

// Set the callback for when the pages make URL requests 
self.addEventListener('fetch', function(event) {
	// Need to clone the request because we are consuming it when reading headers
	const req = event.request.clone();	
	console.log("[mp4box-sw] Fetch request received for URL:", req.url);
	console.log("[mp4box-sw] Request object:", req);
	if (req.headers.forEach) {
		req.headers.forEach(function(value, key) {
			console.log("[mp4box-sw]    "+key +": "+value);
		});
	}


	/* Closure-bound variable holding the MP4Box object for use in Promise onFullfilled callbacks */
	let mp4box;
	let builtResponse = null;

	function fetchPromiseSuccessCallback(response) {
		console.log("[mp4box-sw] Received response for URL:", response.url);
		console.log("[mp4box-sw] Response object:", response);
		if (response.headers.forEach) {
			response.headers.forEach(function(value, key) {
				console.log("[mp4box-sw]    "+ key +": "+value);
			});
		}

		/* if the response is an MP4 file, get an ArrayBuffer of it and inspect it 
		   otherwise simply return the response
		*/
		const contentType = response.headers.get("Content-Type");
		if (contentType === "video/mp4") {
			console.log("[mp4box-sw] The resource is an MP4 file");
			console.log("[mp4box-sw] Creating MP4Box instance for "+ req.url);
			mp4box = MP4Box.createFile();
			urlToMP4Box[req.url] = mp4box;
			mp4box.originalResponse = response.clone();
			return response.arrayBuffer();
		} else {
			return response;
		}
	}

	function arrayBufferPromiseSuccessCallback(arrayBufferOrResponse) {
		if (arrayBufferOrResponse instanceof ArrayBuffer) {
			console.log("[mp4box-sw] Processing ArrayBuffer");
			const arrayBuffer = arrayBufferOrResponse;
			let ok = false;
			arrayBuffer.fileStart = 0;
			mp4box.appendBuffer(arrayBuffer);
			const metaHandler = mp4box.getMetaHandler();
			if (metaHandler === 'html') {
				const item = mp4box.getPrimaryItem();
				console.log("[mp4box-sw] Found primary item in MP4 of type "+item.content_type);					
				arrayBufferResponse = createResponse(item.content_type, item.data.buffer);
				ok = true;
			} 
			if (!ok) {
				console.warn("[mp4box-sw] Could not find useful resource, sending the original response");
				arrayBufferResponse = mp4box.originalResponse.clone();
			}
			return arrayBufferResponse;
		} else {
			console.log("[mp4box-sw] Forwarding response");
			return arrayBufferOrResponse;
		}
	}

	mp4box = urlToMP4Box[req.referrer];
	if (mp4box) {
		console.log("[mp4box-sw] There is an MP4Box instance for the referrer of this resource");
		if (req.url == req.referrer) {
			console.log("[mp4box-sw] The MP4Box instance was created for this resource, sending the original response");
			return mp4box.originalResponse.clone();
		} else {
			/* The requested URL is different from the MP4 referer */
			console.log("[mp4box-sw] Check if this MP4Box has an item for this resource");
			const refer_path= req.referrer.substring(0, req.referrer.lastIndexOf("/"));
	

			if (req.url.startsWith(refer_path)) {
				const item_name = req.url.slice(refer_path.length + 1);
				const item_id = mp4box.hasItem(item_name);
				if (item_id == -1) {
					console.warn("[mp4box-sw] Could not find item "+item_name+" in MP4");
					/* continue to issue the fetch for the resource */
				} else {
					builtResponse = createResponseFromItemId(mp4box, item_id, item_name);
				}
			}
		}	
	} 

	if (builtResponse) {
		event.respondWith(builtResponse);
	} else {
		console.log("[mp4box-sw] Fetching resource");
		event.respondWith(fetch(event.request).then(fetchPromiseSuccessCallback).then(arrayBufferPromiseSuccessCallback));
	}
});

function createResponseFromItemId(mp4box, item_id, item_name) {	
	const item = mp4box.getItem(item_id);
	console.log("[mp4box-sw] Found item "+item_id+" in MP4 of type "+item.content_type+" for item of name: "+item_name);
	return createResponse(item.content_type, item.data.buffer);
}
