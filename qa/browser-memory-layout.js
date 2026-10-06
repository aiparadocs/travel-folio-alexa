// Run with the Playwright browser tool's browser_run_code_unsafe filename option.
// An isolated context and synthetic images never read or change the user's journal.
async (page) => {
  const base = new URL('/phone/', page.url()).href;
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await context.newPage();
  const artifacts = 'qa'; // relative to the Playwright process working directory
  const checks = [], errors = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  p.on('pageerror', error => errors.push(error.message));
  p.on('dialog', dialog => dialog.accept());
  const selectView = async (target, mode) => {
    await target.locator('[data-view="' + mode + '"]:visible').first().click();
    await target.waitForFunction(value => document.body.dataset.mode === value, mode);
  };
  const ready = target => target.waitForFunction(() => {
    const button = document.getElementById('print-confirm');
    return button && !button.disabled;
  });
  const openPrint = async target => {
    await target.locator('[data-action="print"]').first().click();
    await target.locator('#print-dialog').waitFor({ state: 'visible' });
    await ready(target);
  };
  const selectPrint = async (target, mode) => {
    await target.locator('#print-mode').selectOption(mode);
    await ready(target);
  };
  const inspectPhotos = async (target, selector, expected, label) => {
    const dimensions = await target.locator(selector).evaluateAll(async images => {
      await Promise.all(images.map(image => image.decode()));
      return images.map(image => {
        const box = image.getBoundingClientRect();
        const wrapper = image.parentElement.getBoundingClientRect();
        return {
          ratio: box.width / box.height,
          naturalRatio: image.naturalWidth / image.naturalHeight,
          width: box.width,
          height: box.height,
          frameWidth: wrapper.width,
          frameHeight: wrapper.height,
          offsetX: box.left - wrapper.left,
          offsetY: box.top - wrapper.top,
          complete: image.complete && image.naturalWidth > 0
        };
      });
    });
    check(dimensions.length === expected && dimensions.every(d => d.complete && d.width > 0 && d.height > 0), label + ': all photos decoded');
    check(dimensions.every(d => Math.abs(d.ratio / d.naturalRatio - 1) < 0.01), label + ': original aspect ratios are preserved');
    check(dimensions.every(d => Math.abs(d.width - d.frameWidth) < 1.5 && Math.abs(d.height - d.frameHeight) < 1.5 && Math.abs(d.offsetX) < 1.5 && Math.abs(d.offsetY) < 1.5), label + ': wrappers fit their photos without letterbox bands');
  };
  const paperFits = target => target.locator('#print-output').evaluate(root => [...root.querySelectorAll('.folio-print-column')].every(column => column.scrollHeight <= column.clientHeight + 2 && column.scrollWidth <= column.clientWidth + 2));
  const paperBackground = target => target.locator('#print-output .folio-print-page').first().evaluate(element => getComputedStyle(element).backgroundColor);
  try {
    await context.addInitScript(() => {
      const create = URL.createObjectURL;
      URL.createObjectURL = function (blob) { window.__memoryExport = blob; return create.call(this, blob); };
    });
    const photos = await p.evaluate(() => [[800, 800], [600, 1000], [1400, 400]].map(([width, height], i) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const g = canvas.getContext('2d');
      const gradient = g.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, ['#efd3a2', '#bad4c5', '#aecbce'][i]);
      gradient.addColorStop(1, '#f5ead5');
      g.fillStyle = gradient; g.fillRect(0, 0, width, height);
      g.fillStyle = '#fff2c8'; g.beginPath(); g.arc(width * 0.72, height * 0.24, Math.min(width, height) * 0.105, 0, Math.PI * 2); g.fill();
      g.fillStyle = ['#8c996b', '#648b77', '#739897'][i];
      g.beginPath(); g.moveTo(0, height * 0.7); g.lineTo(width * 0.35, height * 0.36); g.lineTo(width * 0.7, height * 0.75); g.lineTo(width, height * 0.47); g.lineTo(width, height); g.lineTo(0, height); g.fill();
      g.fillStyle = '#3c6655'; g.beginPath(); g.moveTo(0, height * 0.86); g.quadraticCurveTo(width * 0.45, height * 0.5, width, height * 0.84); g.lineTo(width, height); g.lineTo(0, height); g.fill();
      return canvas.toDataURL('image/jpeg', 0.85);
    }));
    const titles = ['A little mountain morning', 'The long way through the trees', 'Sky, hills, and room to breathe'];
    const captions = ['Warm light, good coffee, no hurry.', 'One small path became our favourite detour.', 'We stopped here a little longer.'];
    const book = {
      format: 'journey-light', version: 1, id: 'qa-kraft-memory-book', title: 'A little Kyoto detour', place: 'Kyoto', start: '2026-10-10', days: 2, sample: false, notes: '', packing: [],
      stops: photos.map((photo, index) => ({ id: 'shape-' + index, day: 1, time: ['09:30', '11:00', '15:00'][index], title: titles[index], kind: 'other', planNote: 'Leave a little time to look around.', locked: false, done: true, caption: captions[index], photo, stickers: index === 0 ? ['camera'] : [] }))
    };
    await p.route(base, async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/(<script id="book-data" type="application\/json">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(book).replace(/</g, '\\u003c') + b);
      await route.fulfill({ response, body: html });
    });
    await p.goto(base);
    await p.locator('#application').waitFor({ state: 'visible' });
    const planBackground = await p.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
    await selectView(p, 'memory');
    const memoryBackground = await p.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
    check(memoryBackground !== planBackground, 'Memories has a distinct paper background from Itinerary');
    for (const width of [1280, 390, 320]) {
      await p.setViewportSize({ width, height: 900 });
      await inspectPhotos(p, '.memory-media > img', 3, width + 'px memory cards');
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Memories has no horizontal overflow at ' + width + 'px');
      if (width !== 320) {
        await p.evaluate(() => scrollTo(0, 0));
        await p.screenshot({ path: artifacts + (width === 1280 ? '/memory-kraft-desktop.png' : '/memory-kraft-mobile.png'), fullPage: true });
      }
    }
    // Every photo shape must also fit the editor, including at the narrowest viewport.
    for (const index of [0, 1, 2]) {
      await p.locator('[data-memory-id="shape-' + index + '"]').click();
      await p.locator('#editor-dialog').waitFor({ state: 'visible' });
      await inspectPhotos(p, '#edit-photo > .photo', 1, '320px editor photo ' + index);
      check(await p.locator('#editor-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Editor has no horizontal overflow for photo ' + index);
      await p.locator('#editor-dialog [data-action="close"]').first().click();
    }
    await p.setViewportSize({ width: 1280, height: 900 });
    await openPrint(p);
    await selectPrint(p, 'plan');
    const planPaper = await paperBackground(p);
    await selectPrint(p, 'memory');
    check(await paperBackground(p) !== planPaper, 'Printed Memories uses a distinct paper color');
    await inspectPhotos(p, '#print-output .folio-memory-photo', 3, 'Memories print');
    check(await paperFits(p), 'Decoded Memories photos fit measured A4 columns');
    await p.screenshot({ path: artifacts + '/memory-kraft-print.png', fullPage: true });
    await selectPrint(p, 'both');
    await inspectPhotos(p, '#print-output .folio-memory-photo', 3, 'Combined print');
    check(await paperFits(p), 'Decoded combined layout fits measured A4 columns');
    const combinedText = await p.locator('#print-output').textContent();
    check(captions.every(caption => combinedText.includes(caption)) && titles.every(title => combinedText.includes(title)), 'Combined print retains every title and caption');
    await p.locator('#print-dialog [data-action="close"]').first().click();
    await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await inspectPhotos(p, '#print-output .folio-memory-photo', 3, 'Native browser print');
    check(await paperFits(p), 'Native print images fit after decoding');
    await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await p.locator('[data-action="transfer"]').first().click();
    const exportButton = p.locator('[data-action="export-html"]');
    await exportButton.evaluate(button => { for (let parent = button.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; });
    await exportButton.click();
    const exported = await p.evaluate(async () => window.__memoryExport.text());
    const standalone = await context.newPage();
    standalone.on('pageerror', error => errors.push(error.message));
    const exportURL = new URL('/qa-memory-export.html', base).href;
    await standalone.route(exportURL, route => route.fulfill({ contentType: 'text/html', body: exported }));
    await standalone.goto(exportURL);
    await standalone.locator('#application').waitFor({ state: 'visible' });
    await selectView(standalone, 'memory');
    await inspectPhotos(standalone, '.memory-media > img', 3, 'Standalone export');
    check(await standalone.locator('body').evaluate(element => getComputedStyle(element).backgroundColor) === memoryBackground, 'Standalone export retains the Memories paper theme');
    await openPrint(standalone);
    await inspectPhotos(standalone, '#print-output .folio-memory-photo', 3, 'Standalone Memories print');
    check(await paperFits(standalone), 'Standalone export retains measured photo pagination');
    check(errors.length === 0, 'No uncaught errors in Memories, editor, print, or standalone export');
    return { passed: checks.length, checks, screenshots: ['memory-kraft-desktop.png', 'memory-kraft-mobile.png', 'memory-kraft-print.png'] };
  } finally { await context.close(); }
}
