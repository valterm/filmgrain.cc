(() => {
  'use strict';
  const { config, nodes } = JSON.parse(document.getElementById('site-data').textContent);
  const $ = (id) => document.getElementById(id);
  const mobile = window.matchMedia('(max-width: 700px), (hover: none) and (pointer: coarse)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dialog = $('lightbox');
  let coverImage = $('cover-image');
  const coverFrame = document.querySelector('.cover-frame');
  const coverGeometry = new WeakMap();
  let current = document.body.dataset.initial;
  let covers = [], coverIndex = 0, photoIndex = 0;
  let timer, closingTimer;
  let panelAnimations = [];
  let cardTransition;
  const albumScroll = new Map();
  let coverRequest = 0;
  let photoRequest = 0;
  let photoAnimations = [];
  let coverAnimations = [];
  let outgoingCover;
  let paused = reducedMotion.matches;
  let returnFocus;
  document.body.classList.add('js');

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function stopCarousel() {
    window.clearTimeout(timer);
  }
  function scheduleCarousel() {
    stopCarousel();
    if (covers.length < 2 || paused || dialog.open || document.hidden || (mobile.matches && current)) return;
    timer = window.setTimeout(() => changeCover(1), config.carouselInterval);
  }
  function sizeCover(image) {
    const photo = coverGeometry.get(image);
    if (!photo) return;
    const [left, top, right, bottom] = photo.bounds || [0, 0, photo.width, photo.height];
    const width = coverFrame.clientWidth;
    const height = coverFrame.clientHeight;
    if (!width || !height) return;
    // Fit the actual photograph to the panel, excluding its baked-in frame.
    const scale = Math.max(width / (right - left), height / (bottom - top));
    Object.assign(image.style, {
      width: `${photo.width * scale}px`, height: `${photo.height * scale}px`,
      left: `${(width - (right - left) * scale) / 2 - left * scale}px`,
      top: `${(height - (bottom - top) * scale) / 2 - top * scale}px`,
      right: 'auto', bottom: 'auto',
    });
  }
  function clearCoverTransition() {
    coverAnimations.forEach(animation => animation.cancel());
    coverAnimations = [];
    outgoingCover?.remove();
    outgoingCover = null;
  }
  function transitionImages(incoming, outgoing, direction) {
    // Clip each photograph to a viewport-sized layer before moving it. This
    // also works for carousel images enlarged to crop their white borders.
    const incomingLayer = element('div', 'swipe-layer');
    const outgoingLayer = element('div', 'swipe-layer');
    incoming.before(incomingLayer);
    outgoing.before(outgoingLayer);
    incomingLayer.append(incoming);
    outgoingLayer.append(outgoing);
    const sign = direction < 0 ? -1 : 1;
    const timing = { duration: 360, easing: 'cubic-bezier(.25, .8, .25, 1)', fill: 'forwards' };
    const animations = mobile.matches ? [
      incomingLayer.animate([{ transform: `translate3d(${sign * 100}%,0,0)` }, { transform: 'translate3d(0,0,0)' }], timing),
      outgoingLayer.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-sign * 100}%,0,0)` }], timing),
    ] : [outgoingLayer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 240, easing: 'ease-in-out', fill: 'forwards',
    })];
    const clean = () => {
      if (incoming.parentNode === incomingLayer && incomingLayer.isConnected) incomingLayer.before(incoming);
      incomingLayer.remove();
      outgoingLayer.remove();
    };
    Promise.all(animations.map(animation => animation.finished)).then(clean, clean);
    return animations;
  }
  async function paintCover(direction = 0) {
    const request = ++coverRequest;
    const node = covers[coverIndex];
    const index = coverIndex;
    const count = covers.length;
    if (!node?.cover) {
      clearCoverTransition();
      coverImage.hidden = true;
      $('cover-title').textContent = nodes[current].title;
      $('cover-count').textContent = '';
      return;
    }
    // Keep the current photograph visible until the next is decoded.
    const incoming = new Image();
    incoming.src = node.cover.full;
    try { await incoming.decode(); } catch { return; }
    if (request !== coverRequest) return;
    // Finish an in-flight dissolve instead of snapping it to its final frame.
    await Promise.all(coverAnimations.map(animation => animation.finished.catch(() => {})));
    if (request !== coverRequest) return;
    clearCoverTransition();
    const crossfade = !reducedMotion.matches && !coverImage.hidden &&
      coverImage.complete && coverImage.naturalWidth && coverImage.src !== incoming.src;
    const previous = coverImage;
    previous.removeAttribute('id');
    incoming.id = 'cover-image';
    incoming.alt = node.cover.alt || `${node.title} album cover`;
    coverGeometry.set(incoming, node.cover);
    sizeCover(incoming);
    // Insert the decoded element itself; both layers have identical fixed bounds.
    previous.before(incoming);
    coverImage = incoming;
    if (crossfade) {
      outgoingCover = previous;
      outgoingCover.className = 'cover-outgoing';
      outgoingCover.setAttribute('aria-hidden', 'true');
      outgoingCover.alt = '';
    } else previous.remove();
    $('cover-title').textContent = node.title;
    $('cover-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`;
    if (crossfade) {
      const outgoing = outgoingCover;
      if (mobile.matches && direction) {
        coverAnimations = transitionImages(incoming, outgoing, direction);
      } else {
        // Fade one opaque layer over another to avoid a dark dip mid-transition.
        coverAnimations = [outgoing.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 600, easing: 'cubic-bezier(.37, 0, .63, 1)', fill: 'forwards',
      })];
      coverAnimations[0].finished.then(() => outgoing.remove()).catch(() => {});
      }
    }
    if (covers.length > 1) {
      const next = new Image();
      next.src = covers[(coverIndex + 1) % covers.length].cover.full;
    }
  }
  function changeCover(delta) {
    if (!covers.length) return;
    coverIndex = (coverIndex + delta + covers.length) % covers.length;
    paintCover(delta);
    scheduleCarousel();
  }
  function animatePanel(panel) {
    panelAnimations.forEach(animation => animation.cancel());
    panelAnimations = [];
    if (reducedMotion.matches) return;
    // Animate visible sections, not a compositor layer thousands of pixels tall.
    const sections = [...panel.querySelectorAll('.panel-heading, .browser-intro, .contact-intro, .album-card, .photo-card, .contact-links a')];
    const viewport = $('browser').getBoundingClientRect();
    const visible = sections.map(section => ({ section, bounds: section.getBoundingClientRect() })).filter(({ bounds }) => {
      return bounds.bottom > Math.max(0, viewport.top) && bounds.top < Math.min(window.innerHeight, viewport.bottom);
    });
    const rows = [...new Set(visible.map(({ bounds }) => Math.round(bounds.top)))].sort((a, b) => a - b);
    panelAnimations = visible.map(({ section, bounds }) => {
      const card = section.matches('.album-card, .photo-card, .contact-links a');
      return section.animate(
        [
          { opacity: 0, transform: card ? 'translate3d(0, 8px, 0) scale(.98, .96)' : 'translate3d(0, 4px, 0)', transformOrigin: '50% 0%' },
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', transformOrigin: '50% 0%' },
        ],
        {
          duration: 300,
          delay: Math.min(rows.indexOf(Math.round(bounds.top)) * 24, 72),
          easing: 'cubic-bezier(.22, .68, .25, 1)',
          fill: 'backwards',
        },
      );
    });
  }
  function render(key, { focus = false, animate = true } = {}) {
    if (!Object.hasOwn(nodes, key)) key = '';
    current = key;
    document.body.dataset.albumView = key;
    document.querySelector('.viewer').inert = mobile.matches && key !== '';
    const node = nodes[key];
    closeLightbox(true);
    $('album-title').textContent = node.title;
    $('album-description').textContent = node.description;
    $('album-description').hidden = !node.description;
    $('section-label').textContent = key ? key.split('/').map(part => part === '120mm' ? '120' : part).join(' / ') : 'Work';
    $('album-count').textContent = `${String(node.children.length || node.images.length).padStart(2, '0')} ${node.children.length ? 'collections' : 'photographs'}`;
    $('back-link').hidden = node.parent === null;
    $('back-link').href = node.parent === null ? '/' : nodes[node.parent].url;
    const content = $('album-content');
    content.className = node.children.length ? 'album-list' : 'photo-grid';
    const fragment = document.createDocumentFragment();
    if (node.children.length) {
      for (const key of node.children) {
        const child = nodes[key];
        const card = element('a', 'album-card');
        card.href = child.url;
        card.dataset.album = key;
        if (child.cover) {
          const img = element('img', 'album-cover');
          Object.assign(img, { src: child.cover.thumb, alt: '', width: child.cover.width,
            height: child.cover.height, loading: 'lazy', decoding: 'async' });
          card.append(img);
        }
        card.append(element('span', 'album-name', child.title));
        fragment.append(card);
      }
    } else {
      node.images.forEach((photo, index) => {
        const card = element('a', 'photo-card');
        card.href = photo.full;
        card.dataset.photo = index;
        const alt = photo.alt || `${node.title} — photograph ${index + 1}`;
        card.setAttribute('aria-label', `Open ${alt}`);
        const img = element('img');
        Object.assign(img, { src: photo.thumb, alt, width: photo.width, height: photo.height,
          loading: 'lazy', decoding: 'async' });
        card.append(img, element('span', '', String(index + 1).padStart(2, '0')));
        fragment.append(card);
      });
      if (!node.images.length) fragment.append(element('p', '', 'No photographs in this album yet.'));
    }
    content.replaceChildren(fragment);
    covers = node.slides;
    coverIndex = 0;
    paintCover();
    for (const control of document.querySelectorAll('.cover-previous, .cover-next, #carousel-pause')) control.hidden = covers.length < 2;
    updatePauseButton();
    coverTouch.show();
    scheduleCarousel();
    document.title = (key ? node.title + ' · ' : '') + config.title;
    document.querySelector('link[rel="canonical"]').href = config.url + node.url;
    if (focus) {
      (mobile.matches ? window : $('browser')).scrollTo({ top: 0, behavior: 'instant' });
      if (animate) animatePanel($('work-panel'));
      $('browser').focus({ preventScroll: true });
    }
  }
  function setContact(open, focus = false) {
    if (open) stopCardTransition();
    const changed = document.body.classList.contains('contact-open') !== open;
    document.body.classList.toggle('contact-open', open);
    $('contact-link').toggleAttribute('aria-current', open);
    $('work-link').toggleAttribute('aria-current', !open);
    (open ? $('contact-link') : $('work-link')).setAttribute('aria-current', 'page');
    if (focus) {
      (mobile.matches ? window : $('browser')).scrollTo({ top: 0, behavior: 'instant' });
      $('browser').focus({ preventScroll: true });
    }
    if (changed) animatePanel(open ? $('contact') : $('work-panel'));
  }
  function stopCardTransition() {
    if (!cardTransition) return;
    cardTransition.animations.forEach(animation => animation.cancel());
    cardTransition.overlay.remove();
    $('album-content').classList.remove('album-transitioning');
    cardTransition = null;
  }
  function panelBounds() {
    const bounds = $('browser').getBoundingClientRect();
    const top = Math.max(0, bounds.top, $('album-content').getBoundingClientRect().top);
    return { left: bounds.left, top, width: bounds.width,
      height: Math.max(1, Math.min(innerHeight, bounds.bottom) - top) };
  }
  function albumCard(key) {
    return [...$('album-content').querySelectorAll('[data-album]')].find(card => card.dataset.album === key);
  }
  function pushedCardTransform(rect, selected, bounds) {
    // Cards in adjacent rows move vertically; the other card in the row moves sideways.
    if (rect.bottom <= selected.top + 1) return `translate3d(0, ${bounds.top - rect.bottom - 12}px, 0)`;
    if (rect.top >= selected.bottom - 1) return `translate3d(0, ${bounds.top + bounds.height - rect.top + 12}px, 0)`;
    const left = rect.left < selected.left;
    const distance = left ? bounds.left - rect.right - 12 : bounds.left + bounds.width - rect.left + 12;
    return `translate3d(${distance}px, 0, 0)`;
  }
  async function navigate(key, { historyEntry = true } = {}) {
    if (!Object.hasOwn(nodes, key)) key = '';
    stopCardTransition();
    panelAnimations.forEach(animation => animation.cancel());
    const previous = current;
    const back = nodes[previous].parent === key;
    const forward = nodes[key].parent === previous;
    const source = forward ? albumCard(key) : null;
    const start = back ? panelBounds() : source?.getBoundingClientRect();
    const content = $('album-content');
    const outgoing = [...content.children].map(card => ({ card, rect: card.getBoundingClientRect() }));
    albumScroll.set(previous, mobile.matches ? window.scrollY : $('browser').scrollTop);
    if (historyEntry) history.pushState({}, '', nodes[key].url);
    setContact(false);
    render(key, { focus: true, animate: false });
    if (back) {
      (mobile.matches ? window : $('browser')).scrollTo({ top: albumScroll.get(key) || 0, behavior: 'instant' });
    }
    const target = back ? albumCard(previous) : null;
    const end = back ? target?.getBoundingClientRect() : panelBounds();
    if (reducedMotion.matches || !start || !end || !(forward || back)) return;
    const bounds = content.getBoundingClientRect();
    const viewport = panelBounds();
    const layer = element('div', 'album-outgoing');
    layer.setAttribute('aria-hidden', 'true');
    // Retain the actual grid cards instead of floating, scaled cover copies.
    for (const { card, rect } of outgoing) {
      if (card === source || rect.bottom <= viewport.top || rect.top >= innerHeight) continue;
      Object.assign(card.style, { position: 'absolute', left: `${rect.left - bounds.left}px`,
        top: `${rect.top - bounds.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: '0' });
      layer.append(card);
    }
    const incoming = [...content.children];
    content.classList.add('album-transitioning');
    content.append(layer);
    const transition = { overlay: layer, animations: [] };
    cardTransition = transition;
    const timing = { duration: 650, easing: 'cubic-bezier(.2, .7, .25, 1)', fill: 'both' };
    if (forward) {
      for (const { card, rect } of outgoing) {
        if (card.parentNode !== layer) continue;
        transition.animations.push(card.animate([
          { transform: 'translate3d(0, 0, 0)' },
          { transform: pushedCardTransform(rect, start, viewport) },
        ], timing));
      }
    } else {
      // Close the child grid into its original card without scaling the photographs.
      const inset = `inset(${Math.max(0, end.top - bounds.top)}px ${Math.max(0, bounds.right - end.right)}px ${Math.max(0, bounds.height - (end.bottom - bounds.top))}px ${Math.max(0, end.left - bounds.left)}px round 18px)`;
      transition.animations.push(layer.animate([
        { clipPath: 'inset(0px round 0px)', opacity: 1 },
        { clipPath: inset, opacity: 0 },
      ], timing));
    }
    for (const card of incoming) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= viewport.top || rect.top >= innerHeight) continue;
      if (back) {
        if (card === target) continue;
        transition.animations.push(card.animate([
          { transform: pushedCardTransform(rect, end, viewport) },
          { transform: 'translate3d(0, 0, 0)' },
        ], timing));
      } else {
        // Reveal the new grid outwards from the selected card's footprint.
        const inset = `inset(${Math.max(0, start.top - rect.top)}px ${Math.max(0, rect.right - start.right)}px ${Math.max(0, rect.bottom - start.bottom)}px ${Math.max(0, start.left - rect.left)}px round 18px)`;
        transition.animations.push(card.animate([
          { clipPath: inset, opacity: 0 },
          { clipPath: 'inset(0px round 0px)', opacity: 1 },
        ], timing));
      }
    }
    try {
      await Promise.all(transition.animations.map(animation => animation.finished));
    } catch { /* A subsequent navigation replaces this transition. */ }
    finally {
      if (cardTransition === transition) stopCardTransition();
    }
  }
  async function showPhoto(index, direction = 0) {
    const node = nodes[current];
    if (!node.images.length) return;
    photoIndex = (index + node.images.length) % node.images.length;
    const request = ++photoRequest;
    const targetIndex = photoIndex;
    const photo = node.images[targetIndex];
    const image = $('lightbox-image');
    const shouldAnimate = dialog.open && !reducedMotion.matches && direction &&
      node.images.length > 1 && image.complete && image.naturalWidth;
    let outgoing;
    if (shouldAnimate) {
      const decoded = new Image();
      decoded.src = photo.full;
      try { await decoded.decode(); } catch {
        if (request === photoRequest) $('image-error').hidden = false;
        return;
      }
      await Promise.all(photoAnimations.map(animation => animation.finished.catch(() => {})));
      if (request !== photoRequest || !dialog.open) return;
      outgoing = image.cloneNode();
      outgoing.removeAttribute('id');
      outgoing.className = 'lightbox-outgoing';
      outgoing.setAttribute('aria-hidden', 'true');
      image.after(outgoing);
    }
    photoAnimations.forEach(animation => animation.cancel());
    photoAnimations = [];
    $('image-error').hidden = true;
    $('lightbox-image').src = photo.full;
    if (outgoing) photoAnimations = transitionImages(image, outgoing, direction);
    $('lightbox-image').alt = photo.alt || `${node.title} — photograph ${photoIndex + 1}`;
    $('lightbox-album').textContent = current.split('/').map(part => part === '120mm' ? '120' : part).join(' / ');
    $('lightbox-caption').textContent = photo.alt || '';
    $('lightbox-count').textContent = `${String(photoIndex + 1).padStart(2, '0')} / ${String(node.images.length).padStart(2, '0')}`;
    $('lightbox-previous').disabled = $('lightbox-next').disabled = node.images.length < 2;
    if (!dialog.open) {
      window.clearTimeout(closingTimer);
      dialog.classList.remove('closing');
      returnFocus = document.activeElement;
      dialog.showModal();
      photoTouch.show();
      $('lightbox-close').focus();
      stopCarousel();
    }
    const preload = new Image();
    preload.src = node.images[(photoIndex + 1) % node.images.length].full;
  }
  function closeLightbox(immediate = false) {
    if (!dialog.open) return;
    photoRequest++;
    photoAnimations.forEach(animation => animation.cancel());
    photoAnimations = [];
    window.clearTimeout(closingTimer);
    const finish = () => {
      dialog.close();
      dialog.classList.remove('closing');
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      scheduleCarousel();
    };
    if (immediate || reducedMotion.matches) finish();
    else {
      dialog.classList.add('closing');
      closingTimer = window.setTimeout(finish, 220);
    }
  }
  function updatePauseButton() {
    $('carousel-pause').textContent = paused ? '▷' : 'Ⅱ';
    $('carousel-pause').setAttribute('aria-label', paused ? 'Play cover slideshow' : 'Pause cover slideshow');
  }
  function bindSwipe(surface, controls, advance) {
    let start = null;
    let hideTimer;
    const hide = () => {
      clearTimeout(hideTimer);
      controls.classList.add('controls-hidden');
    };
    const show = () => {
      clearTimeout(hideTimer);
      controls.classList.remove('controls-hidden');
      if (mobile.matches) hideTimer = setTimeout(hide, 2000);
    };
    surface.addEventListener('touchstart', event => {
      // Ignore multi-touch/zoom gestures and direct button interactions.
      if (!mobile.matches || event.touches.length !== 1 ||
          event.target.closest('button, a') || (window.visualViewport?.scale || 1) > 1) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: performance.now() };
    }, { passive: true });
    surface.addEventListener('touchmove', event => {
      if (event.touches.length !== 1) start = null;
    }, { passive: true });
    surface.addEventListener('touchcancel', () => { start = null; }, { passive: true });
    surface.addEventListener('touchend', event => {
      const origin = start;
      start = null;
      if (!origin || event.touches.length || (window.visualViewport?.scale || 1) > 1) return;
      const touch = [...event.changedTouches].find(touch => touch.identifier === origin.id);
      if (!touch) return;
      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;
      const duration = performance.now() - origin.time;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && duration < 800) {
        advance(dx < 0 ? 1 : -1);
        hide();
      } else if (Math.hypot(dx, dy) < 10 && duration < 350) show();
    }, { passive: true });
    controls.addEventListener('click', event => {
      if (event.target.closest('button')) show();
    });
    return { show, hide };
  }
  const coverTouch = bindSwipe(document.querySelector('.cover-frame'), document.querySelector('.cover-frame'), changeCover);
  const photoTouch = bindSwipe(document.querySelector('.lightbox-image-wrap'), dialog, delta => showPhoto(photoIndex + delta, delta));
  document.addEventListener('click', event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const album = event.target.closest('[data-album]');
    const photo = event.target.closest('[data-photo]');
    if (album) { event.preventDefault(); navigate(album.dataset.album); }
    else if (photo) { event.preventDefault(); showPhoto(Number(photo.dataset.photo)); }
  });
  $('back-link').addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (nodes[current].parent !== null) navigate(nodes[current].parent);
  });
  $('contact-link').addEventListener('click', event => {
    event.preventDefault();
    if (!document.body.classList.contains('contact-open')) history.pushState({}, '', nodes[current].url + '#contact');
    setContact(true, true);
  });
  $('work-link').addEventListener('click', event => {
    event.preventDefault();
    if (document.body.classList.contains('contact-open')) {
      history.pushState({}, '', nodes[current].url);
      setContact(false, true);
    } else navigate('');
  });
  document.querySelector('.cover-previous').addEventListener('click', () => changeCover(-1));
  document.querySelector('.cover-next').addEventListener('click', () => changeCover(1));
  $('carousel-pause').addEventListener('click', () => { paused = !paused; updatePauseButton(); scheduleCarousel(); });
  $('lightbox-previous').addEventListener('click', () => showPhoto(photoIndex - 1, -1));
  $('lightbox-next').addEventListener('click', () => showPhoto(photoIndex + 1, 1));
  $('lightbox-close').addEventListener('click', () => closeLightbox());
  $('lightbox-image').addEventListener('error', () => { $('image-error').hidden = false; });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeLightbox(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      showPhoto(photoIndex + direction, direction);
    }
  });
  document.addEventListener('visibilitychange', scheduleCarousel);
  mobile.addEventListener('change', () => {
    document.querySelector('.viewer').inert = mobile.matches && current !== '';
    scheduleCarousel();
  });
  window.addEventListener('popstate', () => {
    navigate(decodeURIComponent(location.pathname).replace(/^\/|\/$/g, ''), { historyEntry: false });
    setContact(location.hash === '#contact' || location.pathname === '/imprint/');
  });
  coverGeometry.set(coverImage, nodes[current]?.slides[0]?.cover);
  sizeCover(coverImage);
  new ResizeObserver(() => {
    sizeCover(coverImage);
    if (outgoingCover) sizeCover(outgoingCover);
  }).observe(coverFrame);
  render(current);
  setContact(location.hash === '#contact' || document.body.dataset.contact === 'true');
})();
