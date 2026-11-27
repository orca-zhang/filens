import JSZip from 'jszip';

export async function buildSlideAnimationsFixture(base: Uint8Array, mode: 'objects' | 'paragraphs' | 'chart' = 'objects'): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(base);
  let nextId = 0;
  const wrapper = (nodes: string, attributes: string, conditions = '') => `<p:par>
    <p:cTn id="${++nextId}" ${attributes}>${conditions}<p:childTnLst>${nodes}</p:childTnLst></p:cTn>
  </p:par>`;
  const conditions = (delay: number | 'indefinite') => `<p:stCondLst><p:cond delay="${delay}"/></p:stCondLst>`;
  const behavior = (shape: number, duration: number, visibility = false, subset = '') => `<p:cBhvr>
    <p:cTn id="${++nextId}" dur="${duration}" fill="hold"/>
    <p:tgtEl><p:spTgt spid="${shape}">${subset}</p:spTgt></p:tgtEl>
    ${visibility ? '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>' : ''}
  </p:cBhvr>`;
  const visibility = (shape: number, enter: boolean, subset?: string) =>
    `<p:set>${behavior(shape, 1, true, subset)}<p:to><p:strVal val="${enter ? 'visible' : 'hidden'}"/></p:to></p:set>`;
  const effect = (shape: number, transition: 'in' | 'out', filter: string, duration: number, subset?: string) =>
    `<p:animEffect transition="${transition}" filter="${filter}">${behavior(shape, duration, false, subset)}</p:animEffect>`;
  const action = (nodes: string, preset: number, mode: 'entr' | 'exit', start: string, delay = 0) =>
    wrapper(nodes, `presetID="${preset}" presetClass="${mode}" fill="hold" nodeType="${start}"`, conditions(delay));
  const paragraphRange = (start: number, end: number) => `<p:txEl><p:pRg st="${start}" end="${end}"/></p:txEl>`;
  const click = (nodes: string) => wrapper(nodes, 'fill="hold"', conditions('indefinite'));
  const objectSteps = () => click(
    action(visibility(10, true) + effect(10, 'in', 'fade', 400), 10, 'entr', 'clickEffect') +
      action(visibility(30, true), 1, 'entr', 'withEffect', 120) +
      wrapper(action(effect(31, 'out', 'fade', 200) + visibility(31, false), 10, 'exit', 'afterEffect'), 'fill="hold"', conditions(600)) +
      action(visibility(33, true) + effect(33, 'in', 'wheel(4)', 500), 21, 'entr', 'withEffect') +
      action(effect(34, 'in', 'fade', 200, paragraphRange(20, 20)), 10, 'entr', 'withEffect')
  ) + click(
    action(visibility(32, true) + effect(32, 'in', 'wipe(up)', 400), 22, 'entr', 'clickEffect') +
      action(visibility(30, false), 1, 'exit', 'withEffect')
  );
  const paragraphSteps = () => click(
    action(effect(3, 'in', 'fade', 400, paragraphRange(0, 1)), 10, 'entr', 'clickEffect') +
      action(effect(3, 'out', 'wipe(left)', 200, paragraphRange(3, 3)), 22, 'exit', 'withEffect', 600) +
      action(effect(3, 'in', 'fade', 200, paragraphRange(5, 4)), 10, 'entr', 'withEffect') +
      action(effect(3, 'in', 'fade', 200, paragraphRange(16, 17)), 10, 'entr', 'withEffect') +
      action(effect(3, 'in', 'fade', 200, '<p:txEl><p:charRg st="0" end="2"/></p:txEl>'), 10, 'entr', 'withEffect')
  ) + click(
    action(visibility(3, true, paragraphRange(3, 4)), 1, 'entr', 'clickEffect')
  ) + click(
    action(visibility(3, false), 1, 'exit', 'clickEffect') +
      action(effect(3, 'in', 'fade', 400, paragraphRange(0, 0)), 10, 'entr', 'withEffect', 100)
  );
  const chartTarget = (step: string, indices = '') =>
    `<p:graphicEl><a:chart xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" bldStep="${step}" ${indices}/></p:graphicEl>`;
  const chartSteps = () => [
    action(visibility(3, true, chartTarget('gridLegend')), 1, 'entr', 'clickEffect') +
      action(visibility(3, true, chartTarget('series', 'seriesIdx="1"')), 1, 'entr', 'withEffect') +
      action(visibility(3, true, chartTarget('category', 'categoryIdx="100"')), 1, 'entr', 'withEffect'),
    action(effect(3, 'in', 'fade', 400, chartTarget('series', 'seriesIdx="17"')), 10, 'entr', 'clickEffect'),
    action(visibility(3, true, chartTarget('category', 'categoryIdx="2"')), 1, 'entr', 'clickEffect'),
    action(visibility(3, true, chartTarget('ptInCategory', 'seriesIdx="40" categoryIdx="3"')), 1, 'entr', 'clickEffect'),
    action(visibility(3, true, chartTarget('ptInSeries', 'seriesIdx="40" categoryIdx="1"')), 1, 'entr', 'clickEffect'),
    action(visibility(3, true, chartTarget('allPts')), 1, 'entr', 'clickEffect')
  ].map(click).join('');
  const steps = mode === 'chart' ? chartSteps() : mode === 'paragraphs' ? paragraphSteps() : objectSteps();
  const sequence = `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${++nextId}" dur="indefinite" nodeType="mainSeq">
    <p:childTnLst>${steps}</p:childTnLst></p:cTn></p:seq>`;
  const root = wrapper(sequence, 'dur="indefinite" restart="never" nodeType="tmRoot"');
  const path = mode === 'objects' ? 'ppt/slides/slide2.xml' : 'ppt/slides/slide1.xml';
  const xml = await zip.file(path)!.async('text');
  const builds = mode === 'paragraphs' ? '<p:bldLst><p:bldP spid="3" grpId="0" build="p"/></p:bldLst>'
    : mode === 'chart' ? `<p:bldLst><p:bldGraphic spid="3" grpId="0"><p:bldSub>
        <a:bldChart xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" bld="seriesEl" animBg="1"/>
      </p:bldSub></p:bldGraphic></p:bldLst>` : '';
  zip.file(path, xml.replace('</p:sld>', `<p:timing><p:tnLst>${root}</p:tnLst>${builds}</p:timing></p:sld>`));
  return zip.generateAsync({ type: 'uint8array' });
}
