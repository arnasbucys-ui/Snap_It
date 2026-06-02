// cameraModule.js
// Handles the webcam feed and object detection for the Snap-It Scan tab.
// Uses TensorFlow.js + COCO-SSD to recognise physical objects through the laptop camera.
// Everything runs locally on the user's machine — no data is sent to a server.
// Exposed globally as window.cameraModule so other scripts can call it.

// ── tunable constants ────────────────────────────────────────────────────────

// The minimum confidence score (0–1) a detection must reach before we act on it.
// 0.60 means the model must be at least 60% sure before we count it as a real object.
const CONFIDENCE_THRESHOLD = 0.60;

// How many animation frames to skip between each live-detection run.
// 3 means we run the model on every 3rd frame (~20 times/sec at 60 fps).
// Raise this to 5 or 10 if the app feels slow on an older machine.
const LIVE_FRAME_INTERVAL = 3;

// Translates COCO-SSD's class names into the internal keys used by objectSampleMap.json.
// COCO-SSD uses generic English labels; the sample map uses shorter app-specific keys.
// Any COCO class NOT listed here will still trigger a scan but unlock the "Mystery Hit" fallback.
const COCO_TO_SAMPLE = {
  'cup':          'cup',        // a mug or cup      → Deep Kick sample
  'wine glass':   'mug',        // a wine glass       → Punchy Kick sample
  'book':         'book',       // any book           → Tight Snare sample
  'suitcase':     'box',        // a box or case      → Fat Snare sample
  'bottle':       'bottle',     // a bottle           → Closed Hat sample
  'potted plant': 'plant',      // a plant            → Open Hat sample
  'cell phone':   'phone',      // a phone            → Studio Clap sample
  'laptop':       'laptop',     // a laptop           → Wood Block sample
  'mouse':        'mouse',      // a computer mouse   → Rimshot sample
  'keyboard':     'keyboard',   // a keyboard         → Low Tom sample
  'scissors':     'pen',        // scissors           → High Tom sample
  'remote':       'can',        // a TV remote        → Tin Tap sample
};

// ── module state ─────────────────────────────────────────────────────────────
// These variables are private to this file. They remember the current state
// of the camera and detection loop between function calls.

let videoEl     = null;   // the <video> element that shows the live camera feed
let model       = null;   // the loaded COCO-SSD TensorFlow model object
let mediaStream = null;   // the raw webcam stream returned by getUserMedia

let liveCanvasEl  = null;   // the <canvas> element we draw bounding boxes onto
let liveRunning   = false;  // true while the live-detection loop is active
let liveFrame     = 0;      // counts animation frames so we can skip most of them
let liveDetecting = false;  // prevents two model.detect() calls from running at the same time

// ── public API ────────────────────────────────────────────────────────────────

const cameraModule = {

  // ── init ──────────────────────────────────────────────────────────────────
  // Call this once when the app starts.
  // It asks the OS for camera permission, pipes the stream into the <video> tag,
  // then downloads and initialises the COCO-SSD model.
  // Returns true if everything succeeded, false if anything went wrong.
  async init(videoElement) {

    videoEl = videoElement;   // save the <video> reference so other methods can use it

    _setStatus('Starting camera…');   // show a loading message in the UI

    try {
      // Ask the browser for access to the webcam (video only, no microphone).
      // This is what triggers the "Allow camera?" permission prompt.
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

      // Point the <video> element at the webcam stream so it shows the live feed.
      videoEl.srcObject = mediaStream;

      // Wait until the video element knows the stream's width, height, and duration.
      // We must wait for this before calling play(), otherwise the frame is blank.
      await new Promise(resolve =>
        videoEl.addEventListener('loadedmetadata', resolve, { once: true })
      );

      // Start playing the video feed in the element.
      await videoEl.play();

      console.log('[cameraModule] camera started');   // debug: confirms camera is live
    } catch (err) {
      // getUserMedia throws if the user denies permission or no camera is found.
      console.error('[cameraModule] camera error:', err);

      // Show the error reason in the UI so the user knows what to fix.
      _setStatus('Camera unavailable — ' + err.message +
                 '.  Check your browser/OS privacy settings and reload.');
      return false;   // signal failure to the caller
    }

    _setStatus('Loading detection model…');   // update the UI while the model downloads

    try {
      // cocoSsd is the global variable injected by the COCO-SSD <script> tag in index.html.
      // .load() downloads the model weights (~5 MB) and compiles them on the GPU/CPU.
      model = await cocoSsd.load();

      console.log('[cameraModule] COCO-SSD model ready');   // debug: model is ready to detect
    } catch (err) {
      // Model load can fail if there's no internet on first run, or if TF.js has an error.
      console.error('[cameraModule] model load failed:', err);

      _setStatus('Detection model failed to load.  Check network and reload.');
      return false;   // signal failure to the caller
    }

    _setStatus('Ready — point camera at an object');   // everything worked, tell the user
    return true;   // signal success to the caller
  },

  // ── scan ──────────────────────────────────────────────────────────────────
  // Call this when the user clicks the Scan button.
  // Grabs the current video frame, asks the model what it sees, and returns
  // the best matching object as { type: "cup", confidence: 0.87 }, or null.
  async scan() {

    // Guard: if init() hasn't been called yet, we have no model or video to work with.
    if (!model || !videoEl) {
      console.warn('[cameraModule] scan() called before init()');
      return null;
    }

    let predictions;   // will hold the array of detected objects from the model

    try {
      // Run the model on the current video frame.
      // Returns an array like: [{ class: "cup", score: 0.87, bbox: [x, y, w, h] }, ...]
      predictions = await model.detect(videoEl);
    } catch (err) {
      console.error('[cameraModule] scan detect error:', err);
      return null;   // something went wrong with the model; give up gracefully
    }

    // Print every raw detection to the console for debugging.
    // Useful to see exactly what the model found and how confident it was.
    console.log('[cameraModule] scan detections:', predictions.map(p =>
      p.class + ' ' + Math.round(p.score * 100) + '%'
    ));

    // Keep only detections that:
    //   1. score >= CONFIDENCE_THRESHOLD  — model is confident enough
    //   2. class !== 'person'            — we never want to "scan" a person
    //   3. COCO_TO_SAMPLE[p.class]       — the object maps to one of our samples
    // Then sort highest-confidence first so we can just take [0].
    const mapped = predictions
      .filter(p => p.score >= CONFIDENCE_THRESHOLD && p.class !== 'person' && COCO_TO_SAMPLE[p.class])
      .sort((a, b) => b.score - a.score);

    // If nothing passed all three filters, tell the caller there was no valid detection.
    if (mapped.length === 0) {
      console.log('[cameraModule] scan: nothing above threshold / no matching class');
      return null;
    }

    // Take the highest-scoring surviving detection.
    const best = mapped[0];

    // Build the result object.
    // type is the internal sample key (e.g. "phone"), not the raw COCO class ("cell phone"),
    // because that's what the rest of the app (library, cameraStub) expects.
    const result = { type: COCO_TO_SAMPLE[best.class], confidence: best.score };

    console.log('[cameraModule] scan result:', result);   // debug: log what we're unlocking
    return result;   // hand the result back to the caller (ui.js)
  },

  // ── startLiveDetection ────────────────────────────────────────────────────
  // Starts the continuous bounding-box overlay on the canvas.
  // The user sees coloured boxes around objects in real time so they know
  // what the camera is picking up before they click Scan.
  // Must be called after init() because it needs the model and video stream.
  startLiveDetection(canvasElement) {

    // Guard: no point starting the loop if the model isn't loaded yet.
    if (!model || !videoEl) {
      console.warn('[cameraModule] startLiveDetection() called before init()');
      return;
    }

    liveCanvasEl  = canvasElement;   // save the canvas reference for _drawOverlay to use
    liveRunning   = true;            // tell the loop it's allowed to keep going
    liveFrame     = 0;               // reset the frame counter
    liveDetecting = false;           // reset the concurrency guard

    _liveLoop();   // kick off the animation loop
  },

  // ── stopLiveDetection ─────────────────────────────────────────────────────
  // Pauses the bounding-box overlay without releasing the camera.
  // The video feed keeps playing; we just stop running the model on each frame.
  stopLiveDetection() {
    liveRunning = false;   // the loop checks this flag and exits on the next tick
  },

  // ── stop ──────────────────────────────────────────────────────────────────
  // Fully shuts down the camera.
  // Call this when the user navigates away from the Scan tab to free OS resources.
  stop() {

    liveRunning = false;   // stop the live detection loop first

    // Stop each individual camera track (there's usually just one for video).
    // This turns off the camera indicator light on the laptop.
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;   // release the reference so it can be garbage-collected
    }

    // Detach the stream from the video element and clear our reference to it.
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl = null;
    }
  },
};

// ── live detection loop (internal) ───────────────────────────────────────────
// This function is called by requestAnimationFrame on every screen repaint (~60 fps).
// It only actually runs the model every LIVE_FRAME_INTERVAL frames to avoid
// saturating the CPU/GPU, then draws the resulting bounding boxes.

async function _liveLoop() {

  // If stopLiveDetection() was called, just return without scheduling the next frame.
  if (!liveRunning) return;

  liveFrame++;   // increment the frame counter on every tick

  // Only run the model when:
  //   - we've hit a multiple-of-LIVE_FRAME_INTERVAL frame  (throttle)
  //   - the model and video are available
  //   - the previous detect() call has already finished    (no stacking)
  if (liveFrame % LIVE_FRAME_INTERVAL === 0 && model && videoEl && !liveDetecting) {

    liveDetecting = true;   // lock: mark that an inference is in progress

    try {
      // Run the model on the current video frame (same call as scan(), but not filtered).
      const predictions = await model.detect(videoEl);

      // Draw the bounding boxes from this batch of predictions.
      _drawOverlay(liveCanvasEl, predictions);
    } catch (err) {
      // Detection errors during live preview are non-fatal — just log and continue.
      console.warn('[cameraModule] live detect error:', err);
    }

    liveDetecting = false;   // unlock: next eligible frame can run the model again
  }

  // Schedule this same function to run again on the next screen repaint.
  requestAnimationFrame(_liveLoop);
}

// ── canvas overlay ────────────────────────────────────────────────────────────
// Draws coloured bounding boxes + confidence labels on top of the video feed.
// Red = object maps to a sample (useful), Grey = detected but no sample mapped.

function _drawOverlay(canvasEl, predictions) {

  // Skip drawing if the canvas isn't set up or the video hasn't loaded a frame yet.
  if (!canvasEl || !videoEl || !videoEl.videoWidth) return;

  // Match the canvas pixel dimensions to the video so boxes line up correctly.
  canvasEl.width  = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;

  const ctx = canvasEl.getContext('2d');   // get the 2D drawing context

  // Wipe whatever was drawn last frame before drawing the new boxes.
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  // Draw one box + label for each prediction.
  predictions.forEach(pred => {

    // Skip anything below 0.40 confidence — too noisy to be useful visually.
    // Also skip "person" so we never draw boxes around people.
    if (pred.score < 0.40 || pred.class === 'person') return;

    // bbox is [x, y, width, height] in pixels relative to the video frame.
    const [x, y, w, h] = pred.bbox;

    // true if this COCO class maps to one of our samples (it's "useful").
    const mapped = !!COCO_TO_SAMPLE[pred.class];

    // Red outline for usable objects, grey for everything else.
    ctx.strokeStyle = mapped ? '#d8392b' : '#6f6e68';
    ctx.lineWidth   = mapped ? 2.5 : 1.5;   // slightly thicker line for important objects

    // Draw the rectangle around the detected object.
    ctx.strokeRect(x, y, w, h);

    // Build the label text: class name + confidence percentage.
    const label = pred.class + '  ' + Math.round(pred.score * 100) + '%';

    ctx.font = 'bold 12px Bahnschrift, "Segoe UI", system-ui, sans-serif';

    // Measure the label text width so we can size the background chip to fit.
    const tw = ctx.measureText(label).width;

    // Fill a coloured rectangle behind the text so it's readable over any background.
    ctx.fillStyle = mapped ? '#d8392b' : '#6f6e68';
    // If the box is near the top of the frame, draw the chip below the top edge instead.
    ctx.fillRect(x, y > 20 ? y - 22 : y, tw + 10, 20);

    // Draw the white label text on top of the coloured chip.
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 5, y > 20 ? y - 6 : y + 14);
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Updates the status paragraph (#vision-status) beneath the camera feed.
// Centralised here so every part of the module calls one function instead of
// repeating the getElementById + textContent pattern everywhere.
function _setStatus(msg) {
  const el = document.getElementById('vision-status');   // find the status element in the DOM
  if (el) el.textContent = msg;                          // only update it if it exists
}

// ── export ────────────────────────────────────────────────────────────────────

// Attach the module to window so ui.js and any other plain <script> can access it.
window.cameraModule = cameraModule;
