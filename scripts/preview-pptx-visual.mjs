import assert from 'node:assert/strict';

export const pptxVisualFixtures = ['filens-field-notes.pptx', 'rich-pptx-shapes.pptx', 'rich-pptx-pictures.pptx'];

const navy = [7, 22, 46];
const colorDistance = (a, b) => Math.max(...b.map((channel, index) => Math.abs(channel - a[index])));

async function openSlide(page, index, aspect) {
  const shell = page.locator(`.pptxv-slide-shell[data-slide-index="${index}"]`);
  await shell.scrollIntoViewIfNeeded();
  const slide = shell.locator('.pptxv-slide');
  await slide.waitFor();
  const frame = await slide.boundingBox();
  assert.ok(frame && frame.width > 0 && frame.height > 0, `Slide ${index + 1}: empty frame`);
  assert.ok(Math.abs(frame.width / frame.height - aspect) < 0.01, `Slide ${index + 1}: wrong aspect ratio`);
  return { slide, frame };
}

async function checkBox(locator, frame, expected, description) {
  await locator.waitFor();
  const box = await locator.boundingBox();
  assert.ok(box, `${description}: missing render bounds`);
  const actual = [(box.x - frame.x) / frame.width, (box.y - frame.y) / frame.height,
    box.width / frame.width, box.height / frame.height];
  assert.ok(expected.every((value, index) => Math.abs(value - actual[index]) < 0.005),
    `${description}: relative bounds ${actual}, expected ${expected}`);
}

async function sampleColors(slide, points) {
  const png = await slide.screenshot({ animations: 'disabled', scale: 'css' });
  return slide.evaluate(async (_element, { png, points }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return points.map(([x, y]) => Array.from(ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data));
  }, { png: png.toString('base64'), points });
}

export async function checkPptxVisual(page, file) {
  if (!pptxVisualFixtures.includes(file)) return;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (file === 'filens-field-notes.pptx') {
    // Relative coordinates from the authored 1200 × 675 slide boxes.
    const slides = [
      { title: 'BEYOND', image: [0.4, 0, 0.6, 1], panel: [0.02, 0.8], photo: [0.86, 0.27] },
      { title: 'CHASE THE LIGHT.', image: [0, 0, 1, 1], panel: [0.89, 0.82], photo: [0.86, 0.27] },
      { title: 'A universe', image: [0.45, 0, 0.55, 1], panel: [0.46, 0.38], photo: [0.86, 0.27] }
    ];
    assert.equal(await page.locator('.pptxv-slide-shell[data-slide-index]').count(), slides.length);
    for (const [index, expected] of slides.entries()) {
      const { slide, frame } = await openSlide(page, index, 16 / 9);
      const title = slide.getByText(expected.title, { exact: true });
      await title.waitFor();
      const titleBox = await title.boundingBox();
      assert.ok(titleBox && titleBox.width > 0 && titleBox.y >= frame.y &&
        titleBox.y + titleBox.height <= frame.y + frame.height, `Slide ${index + 1}: title outside the slide`);
      const image = slide.locator('.pptxv-item--image');
      await checkBox(image, frame, expected.image, `Slide ${index + 1} photo`);
      assert.ok(await image.locator('img').evaluate(async img => { await img.decode(); return img.naturalWidth > 0; }));
      const points = [expected.panel, expected.photo];
      if (index === 0) points.push([82 / 1200, 428 / 675]);
      const [panel, photograph, accent] = await sampleColors(slide, points);
      assert.ok(colorDistance(panel, navy) < 8, `Slide ${index + 1}: dark panel painted as ${panel}`);
      assert.ok(colorDistance(photograph, navy) > 36, `Slide ${index + 1}: photo region painted as ${photograph}`);
      if (accent) assert.ok(colorDistance(accent, [18, 141, 255]) < 8, `Slide 1: accent stripe painted as ${accent}`);
    }
    return { slides: [1, 2, 3], checks: ['aspect ratio', 'title bounds', 'photograph placement', 'panel and accent paint order'] };
  }

  if (file === 'rich-pptx-pictures.pptx') {
    // Picture 3 on each slide is cropped. Points are relative to its visible frame.
    const pictures = [
      { box: [589.44, 341.76, 138.24, 36.48], size: [140, 56],
        points: [[0.11, 0.14], [0.26, 0.32], [0.56, 0.71]], colors: [[54, 109, 156], [255, 202, 59], [255, 255, 255]] },
      { box: [573.44, 261.721, 198.56, 198.945], size: [150, 214],
        points: [[0.69, 0.22], [0.62, 0.32], [0.41, 0.6]], colors: [[18, 26, 31], [220, 178, 197], [18, 21, 20]] }
    ];
    for (const [index, expected] of pictures.entries()) {
      const { slide, frame } = await openSlide(page, index, 4 / 3);
      const picture = slide.locator('.pptxv-item--image').filter({ has: page.getByRole('img', { name: 'Picture 3', exact: true }) });
      await checkBox(picture, frame, expected.box.map((value, axis) => value / (axis % 2 ? 720 : 960)), `Slide ${index + 1} cropped picture`);
      const size = await picture.locator('img').evaluate(async img => { await img.decode(); return [img.naturalWidth, img.naturalHeight]; });
      assert.deepEqual(size, expected.size);
      assert.equal(await picture.evaluate(element => getComputedStyle(element).overflow), 'hidden');
      const rendered = await sampleColors(picture, expected.points);
      for (const [point, color] of rendered.entries()) {
        assert.ok(colorDistance(color, expected.colors[point]) < 20,
          `Slide ${index + 1}: cropped pixel ${point + 1} painted as ${color}, expected ${expected.colors[point]}`);
      }
    }
    return { slides: [1, 2], checks: ['authored picture bounds', 'source dimensions', 'clipping and crop pixels'] };
  }

  const { slide, frame } = await openSlide(page, 0, 4 / 3);
  // DrawingML transforms in ppt/slides/slide1.xml.
  const table = slide.locator('.pptxv-item--table');
  await checkBox(table, frame, [502.680 / 960, 201.242 / 720, 400.674 / 960, 77.867 / 720], 'Table');
  await table.getByText('shapes[3]', { exact: true }).waitFor();
  assert.equal(await table.locator('td').count(), 4);
  const chart = slide.getByRole('img', { name: 'shapes[4]', exact: true });
  await checkBox(chart, frame, [49.086 / 960, 367.560 / 720, 400.674 / 960, 205.773 / 720], 'Pie chart');
  const slices = await chart.locator('path[data-value]').evaluateAll(paths => paths.map(path => {
    const { width, height } = path.getBBox();
    return [Number(path.dataset.value), path.getAttribute('fill'), width > 0 && height > 0];
  }));
  assert.deepEqual(slices, [[8.2, '#4F81BD', true], [3.2, '#C0504D', true], [1.4, '#9BBB59', true], [1.2, '#8064A2', true]]);
  return { slides: [1], checks: ['aspect ratio', 'table and chart placement', 'table grid', 'pie chart slice colors and geometry'] };
}
