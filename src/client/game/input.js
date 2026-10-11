// Keyboard input.
// Methods are mixed into the Game class (see game.js); `this` is the Game.

export class InputMethods {
  // =========================================================================
  // INPUT
  // =========================================================================

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.postfx) this.postfx.resize(window.innerWidth, window.innerHeight, this.renderer.getPixelRatio());
  }

  /** True while a text field (name box, chat, settings) has focus */
  isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  onKeyDown(event) {
    const chatInput = document.getElementById('chat-input');
    if (this.audio && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();

    // Typing somewhere other than chat (e.g. the pilot name box): let every
    // key through untouched — flight keys must never eat letters
    if (this.isTyping() && document.activeElement !== chatInput) return;

    // If chat input is focused, only handle Escape to blur
    if (document.activeElement === chatInput) {
      if (event.key === 'Escape') {
        chatInput.blur();
      }
      return;
    }

    // Settings panel open: Escape closes it, everything else goes to the form
    if (this.instruments?.settingsOpen) {
      if (event.key === 'Escape') {
        this.instruments.toggleSettings(false);
        event.preventDefault();
      }
      return;
    }

    // Tutorial open: Enter/Escape/Space dismisses it (and starts takeoff)
    const tutorial = document.getElementById('tutorial');
    if (tutorial && tutorial.style.display === 'block') {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        this.closeTutorial();
        event.preventDefault();
      }
      return;
    }

    // Space skips the takeoff cinematic
    if (this.takeoffPhase && event.key === ' ') {
      this.skipTakeoff();
      event.preventDefault();
      return;
    }

    // Focus chat input on Enter (expand it first — a collapsed input can't take focus)
    if (event.key === 'Enter' && chatInput) {
      this.instruments?.setChatCollapsed(false);
      chatInput.focus();
      event.preventDefault();
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'w': this.controls.throttleUp = true; break;
      case 's': this.controls.throttleDown = true; break;
      case 'a': case 'q': case 'arrowleft': this.controls.left = true; event.preventDefault(); break;
      case 'd': case 'e': case 'arrowright': this.controls.right = true; event.preventDefault(); break;
      case 'arrowup': this.controls.pitchUp = true; event.preventDefault(); break;
      case 'arrowdown': this.controls.pitchDown = true; event.preventDefault(); break;
      case 'shift': this.controls.boost = true; break;
      case ' ': this.controls.shooting = true; event.preventDefault(); break;
      case 'r': this.startBarrelRoll(); break;
      case 'f': this.fireMissile(); break;
      case 'g': this.deployFlares(); break;
      case 'b': this.dropBomb(); break;
      case 'm': this.toggleMute(); break;
      case 'p': if (this.localPlayer) this.togglePhotoMode(); break;
      case 'c': this.captureRequested = true; break;
      case 'h': this.toggleControlsPanel(); break;
      case 'x': this.skipOnboarding(); break;
      case 'tab': this.setScoreboardOpen(true); event.preventDefault(); break;
      case 'escape': this.instruments.toggleSettings(true); event.preventDefault(); break;
    }
  }

  onKeyUp(event) {
    // Ignore key ups while typing anywhere
    if (this.isTyping()) return;

    switch (event.key.toLowerCase()) {
      case 'w': this.controls.throttleUp = false; break;
      case 's': this.controls.throttleDown = false; break;
      case 'a': case 'q': case 'arrowleft': this.controls.left = false; event.preventDefault(); break;
      case 'd': case 'e': case 'arrowright': this.controls.right = false; event.preventDefault(); break;
      case 'arrowup': this.controls.pitchUp = false; event.preventDefault(); break;
      case 'arrowdown': this.controls.pitchDown = false; event.preventDefault(); break;
      case 'shift': this.controls.boost = false; break;
      case ' ': this.controls.shooting = false; event.preventDefault(); break;
      case 'tab': this.setScoreboardOpen(false); event.preventDefault(); break;
    }
  }
}
