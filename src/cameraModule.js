// cameraModule.js
// Webcam access + COCO-SSD object detection for Snap-It.
// Depends on window.cocoSsd (loaded by the coco-ssd UMD bundle in index.html).
//
// Public API  →  window.cameraModule
//   init(videoElement)          async  start webcam + load model
//   scan()                      async  capture one frame, return { type, confidence } or null
//   startLiveDetection(canvas)         draw bounding-box overlay; call after init()
//   stopLiveDetection()                pause the overlay loop
//   stop()                             release the camera

// ── tunable constants ────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD  = 0.60;  // detections below this are ignored
const LIVE_FRAME_INTERVAL   = 3;     // run model every Nth rAF tick (raise to 5–10 if slow)

// COCO-SSD class name → internal objectSampleMap.json key.
// Only classes that have an explicit entry in the sample map are listed;
// anything else falls through to the library's "_default" (Mystery Hit) path.
const COCO_TO_SAMPLE = {
  'cup':          'cup',
  'wine glass':   'mug',
  'book':         'book',
  'suitcase':     'box',
  'bottle':       'bottle',
  'potted plant': 'plant',
  'cell phone':   'phone',
  'laptop':       'laptop',
  'mouse':        'mouse',
  'keyboard':     'keyboard',
  'scissors':     'pen',
  'remote':       'can',
};

// ── module state ─────────────────────────────────────────────────────────────

let videoEl      = null;
let model        = null;
let mediaStream  = null;

let liveCanvasEl  = null;
let liveRunning   = false;
let liveFrame     = 0;
let liveDetecting = false;   // guard: don't stack async detect() calls

// ── public API ────────────────────────────────────────────────────────────────

const cameraModule = {

  // Call once on app start.  Sets up the webcam feed and loads the ML model.
  // Returns true on success, false if the camera or model could not be started.
  async init(videoElement) {
    videoEl = videoElement;

    _setStatus('Starting camera…');
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      videoEl.srcObject = mediaStream;
      await new Promise(resolve =>
        videoEl.addEventListener('loadedmetadata', resolve, { once: true })
      );
      await videoEl.play();
      console.log('[cameraModule] camera started');
    } catch (err) {
      console.error('[cameraModule] camera error:', err);
      _setStatus('Camera unavailable — ' + err.message +
                 '.  Check your browser/OS privacy settings and reload.');
      return false;
    }

    _setStatus('Loading detection model…');
    try {
      // cocoSsd is the global injected by the UMD bundle loaded in index.html.
      model = await cocoSsd.load();
      console.log('[cameraModule] COCO-SSD model ready');
    } catch (err) {
      console.error('[cameraModule] model load failed:', err);
      _setStatus('Detection model failed to load.  Check network and reload.');
      return false;
    }

    _setStatus('Ready — point camera at an object');
    return true;
  },

  // Call when the user clicks "Scan".
  // Captures the current video frame, runs COCO-SSD, and returns the
  // highest-confidence mapped object above the threshold, or null.
  // Return shape: { type: "cup", confidence: 0.87 }
  async scan() {
    if (!model || !videoEl) {
      console.warn('[cameraModule] scan() called before init()');
      return null;
    }

    let predictions;
    try {
      predictions = await model.detect(videoEl);
    } catch (err) {
      console.error('[cameraModule] scan detect error:', err);
      return null;
    }

    // Log every detection for debugging.
    console.log('[cameraModule] scan detections:', predictions.map(p =>
      p.class + ' ' + Math.round(p.score * 100) + '%'
    ));

    // Filter: must meet threshold, must not be "person", and must have a mapping.
    const mapped = predictions
      .filter(p => p.score >= CONFIDENCE_THRESHOLD && p.class !== 'person' && COCO_TO_SAMPLE[p.class])
      .sort((a, b) => b.score - a.score);

    if (mapped.length === 0) {
      console.log('[cameraModule] scan: nothing above threshold / no matching class');
      return null;
    }

    const best = mapped[0];
    const result = { type: COCO_TO_SAMPLE[best.class], confidence: best.score };
    console.log('[cameraModule] scan result:', result);
    return result;
  },

  // Starts a continuous overlay loop that draws bounding boxes on canvasElement.
  // Runs detection every LIVE_FRAME_INTERVAL frames so it doesn't saturate the CPU.
  startLiveDetection(canvasElement) {
    if (!model || !videoEl) {
      console.warn('[cameraModule] startLiveDetection() called before init()');
      return;
    }
    liveCanvasEl  = canvasElement;
    liveRunning   = true;
    liveFrame     = 0;
    liveDetecting = false;
    _liveLoop();
  },

  stopLiveDetection() {
    liveRunning = false;
  },

  // Release the webcam.  Call when navigating away from the Scan tab.
  stop() {
    liveRunning = false;
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl = null;
    }
  },
};

// ── live detection loop (internal) ───────────────────────────────────────────

async function _liveLoop() {
  if (!liveRunning) return;

  liveFrame++;
  if (liveFrame % LIVE_FRAME_INTERVAL === 0 && model && videoEl && !liveDetecting) {
    liveDetecting = true;
    try {
      const predictions = await model.detect(videoEl);
      _drawOverlay(liveCanvasEl, predictions);
    } catch (err) {
      console.warn('[cameraModule] live detect error:', err);
    }
    liveDetecting = false;
  }

  requestAnimationFrame(_liveLoop);
}

// ── canvas overlay ────────────────────────────────────────────────────────────

function _drawOverlay(canvasEl, predictions) {
  if (!canvasEl || !videoEl || !videoEl.videoWidth) return;

  canvasEl.width  = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;

  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  predictions.forEach(pred => {
    // Draw everything above 0.4 so the user can see faint matches too;
    // skip "person" entirely.
    if (pred.score < 0.40 || pred.class === 'person') return;

    const [x, y, w, h] = pred.bbox;
    const mapped = !!COCO_TO_SAMPLE[pred.class];

    // Red box for mapped (usable) objects; grey for everything else.
    ctx.strokeStyle = mapped ? '#d8392b' : '#6f6e68';
    ctx.lineWidth   = mapped ? 2.5 : 1.5;
    ctx.strokeRect(x, y, w, h);

    // Label chip above the box.
    const label = pred.class + '  ' + Math.round(pred.score * 100) + '%';
    ctx.font = 'bold 12px Bahnschrift, "Segoe UI", system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = mapped ? '#d8392b' : '#6f6e68';
    ctx.fillRect(x, y > 20 ? y - 22 : y, tw + 10, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 5, y > 20 ? y - 6 : y + 14);
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

function _setStatus(msg) {
  const el = document.getElementById('vision-status');
  if (el) el.textContent = msg;
}

// ── export ────────────────────────────────────────────────────────────────────

window.cameraModule = cameraModule;
