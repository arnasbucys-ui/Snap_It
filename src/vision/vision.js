// src/vision/vision.js
// Handles the webcam + object detection.
//
// For now this is a thin skeleton — it just gets the webcam stream and
// shows it in the <video> element. Later we'll load a TensorFlow.js model
// (e.g. coco-ssd) or call Google Cloud Vision to identify objects and emit
// detection events that the audio layer can react to.

window.Vision = (() => {

  let videoEl = null;
  let stream = null;

  /**
   * Start the webcam and bind it to the given <video> element.
   */
  async function start(videoElement) {
    videoEl = videoElement;
    try {
      // Ask the browser for camera access. The user must approve this once.
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      videoEl.srcObject = stream;
      console.log('[Vision] Camera started');

      // TODO: load TensorFlow.js model here, then start a detection loop.
      // Example shape (left commented so the app runs without TF installed):
      //
      // const cocoSsd = require('@tensorflow-models/coco-ssd');
      // const model = await cocoSsd.load();
      // detectLoop(model);
    } catch (err) {
      console.error('[Vision] Could not access camera:', err);
    }
  }

  /**
   * Stop the webcam stream.
   */
  function stop() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  /**
   * Placeholder detection loop. Real implementation would call the model
   * on each animation frame and dispatch a custom event with the results.
   */
  // async function detectLoop(model) {
  //   const predictions = await model.detect(videoEl);
  //   window.dispatchEvent(new CustomEvent('objects-detected', { detail: predictions }));
  //   requestAnimationFrame(() => detectLoop(model));
  // }

  // Expose a tiny public API.
  return { start, stop };
})();
