import JSZip from 'jszip';

export const legacyComment = '先检查图注。\n<em>源文件中的字面文本</em>';
export const modernComment = 'Check totals & units.\n2. Reconcile rounding.';
export const modernRootId = '{11111111-1111-1111-1111-111111111111}';
export const modernReplyId = '{22222222-2222-2222-2222-222222222222}';

export async function buildSlideCommentsFixture(base: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(base);
  const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const threading = 'http://schemas.microsoft.com/office/powerpoint/2012/main';
  const modern = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main';
  const review = 'http://schemas.microsoft.com/office/2018/10/relationships';
  const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const parent = (authorId: number, idx: number) => `<thread:parentCm authorId="${authorId}" idx="${idx}"/>`;
  const extension = (details = '') => `<p:extLst><p:ext uri="{C676402C-5697-4E1C-873F-D02D1690AC5C}">
    <thread:threadingInfo timeZoneBias="-480">${details}</thread:threadingInfo></p:ext></p:extLst>`;
  const comment = (authorId: number, idx: number, text: string, details = '') => `<p:cm authorId="${authorId}" idx="${idx}" dt="2026-11-26T12:30:00">
    <p:pos x="3600" y="-6"/><p:text>${text}</p:text>${extension(details)}</p:cm>`;
  const legacy = 'ppt/review/legacy-slide.xml';
  const participants = 'ppt/review/legacy-authors.xml';
  const modernPart = 'ppt/review/selected.xml';
  const stalePart = 'ppt/review/unreferenced.xml';
  const modernAuthors = 'ppt/review/modern-authors.xml';
  zip.file(legacy, `<p:cmLst xmlns:p="${presentation}" xmlns:thread="${threading}">
    ${comment(1, 2, 'Legacy reply before its parent.', parent(7, 4))}
    ${comment(7, 4, '先检查图注。\n&lt;em&gt;源文件中的字面文本&lt;/em&gt;')}
    ${comment(9, 1, 'Reply to the reply.', parent(1, 2))}
    ${comment(7, 8, 'Orphaned reply remains readable.', parent(9, 99))}
  </p:cmLst>`);
  zip.file(participants, `<cmAuthorLst xmlns="${presentation}">
    <cmAuthor id="7" name="陈阳" initials="CY" lastIdx="8" clrIdx="0"/>
    <cmAuthor id="1" name="Jordan Lee" initials="JL" lastIdx="2" clrIdx="1"/>
    <cmAuthor id="9" name="Taylor" initials="T" lastIdx="1" clrIdx="2"/>
  </cmAuthorLst>`);
  const maya = '{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}';
  const luis = '{BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}';
  zip.file(modernAuthors, `<review:authorLst xmlns:review="${modern}">
    <review:author id="${maya.toLowerCase()}" name="Maya Chen" initials="MC" userId="maya@example.invalid" providerId=""/>
    <review:author id="${luis}" name="Luis Ortiz" initials="LO" userId="luis@example.invalid" providerId=""/>
  </review:authorLst>`);
  const body = (runs: string) => `<txBody xmlns:d="${drawing}"><d:bodyPr/><d:lstStyle/><d:p>${runs}</d:p></txBody>`;
  const authored = `<cmLst xmlns="${modern}" xmlns:ac="http://schemas.microsoft.com/office/drawing/2013/main/command">
    <cm id="${modernRootId}" authorId="${maya}" created="2026-11-26T06:10:00Z" status="resolved" title="Recheck table"
        startDate="2026-11-26T00:00:00Z" dueDate="2026-11-28T00:00:00Z" assignedTo="${luis}" complete="75%">
      <ac:txMkLst/><pos x="28575" y="38100"/>
      <replyLst><reply id="${modernReplyId}" authorId="${luis}" created="2026-11-26T10:05:00+02:00" status="closed">
        ${body('<d:r><d:t>The totals now agree.</d:t></d:r>')}
      </reply></replyLst>
      ${body('<d:r><d:t>Check totals &amp; units.</d:t></d:r><d:br/><d:fld id="{CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC}"><d:t>2.</d:t></d:fld><d:r><d:t xml:space="preserve"> Reconcile rounding.</d:t></d:r>')}
    </cm>
  </cmLst>`;
  zip.file(modernPart, authored);
  zip.file(stalePart, authored.replace('Check totals &amp; units.', 'Stale unreferenced comment.'));
  const appendRels = async (path: string, elements: string) => {
    const xml = await zip.file(path)!.async('text');
    zip.file(path, xml.replace('</Relationships>', `${elements}</Relationships>`));
  };
  await appendRels('ppt/_rels/presentation.xml.rels',
    `<Relationship Id="rIdLegacyAuthors" Type="${office}/commentAuthors" Target="review/legacy-authors.xml"/>
    <Relationship Id="rIdModernAuthors" Type="${review}/authors" Target="review/modern-authors.xml"/>`);
  await appendRels('ppt/slides/_rels/slide1.xml.rels',
    `<Relationship Id="rIdTraditionalReview" Type="${office}/comments" Target="../review/legacy-slide.xml"/>`);
  await appendRels('ppt/slides/_rels/slide2.xml.rels',
    `<Relationship Id="rIdUnreferencedReview" Type="${review}/comments" Target="../review/unreferenced.xml"/>
    <Relationship Id="rIdSelectedReview" Type="${review}/comments" Target="../review/selected.xml"/>`);
  const path = 'ppt/slides/slide2.xml';
  const slide = await zip.file(path)!.async('text');
  zip.file(path, slide.replace('</p:sld>', `<p:extLst><p:ext uri="{6950BFC3-D8DA-4A85-94F7-54DA5524770B}">
    <modern:commentRel xmlns:modern="${modern}" xmlns:rel="${office}" rel:id="rIdSelectedReview"/>
    </p:ext></p:extLst></p:sld>`));
  const contentTypes = await zip.file('[Content_Types].xml')!.async('text');
  zip.file('[Content_Types].xml', contentTypes.replace('</Types>', [
    [legacy, 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml'],
    [participants, 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml'],
    [modernPart, 'application/vnd.ms-powerpoint.comments+xml'],
    [stalePart, 'application/vnd.ms-powerpoint.comments+xml'],
    [modernAuthors, 'application/vnd.ms-powerpoint.authors+xml']
  ].map(([path, type]) => `<Override PartName="/${path}" ContentType="${type}"/>`).join('') + '</Types>'));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildCommentReviewFixture(base: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildSlideCommentsFixture(base));
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const reactions = 'http://schemas.microsoft.com/office/powerpoint/2022/03/main';
  const tasks = 'http://schemas.microsoft.com/office/powerpoint/2022/08/main';
  const owner = '{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}';
  const editor = '{BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}';
  const unknown = '{EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE}';
  const review = 'ppt/review/selected.xml';
  const eventId = (index: number) => `{77777777-0000-4000-8000-${index.toString().padStart(12, '0')}}`;
  const time = '2026-11-26T09:15:00Z';
  const event = (index: number, change: string, actor = owner, commentId = modernRootId) =>
    `<task:event id="${eventId(index)}" time="${time}"><task:atrbtn authorId="${actor}"/>
      <task:anchr><task:comment id="${commentId}"/></task:anchr>${change}</task:event>`;
  const instance = (id: string) => `<rx:instance authorId="${id}" time="${time}"/>`;
  const reaction = (emoji: string, author: string) => `<rx:rxn type="${emoji}">${instance(author)}</rx:rxn>`;
  const reactionExt = (groups: string) => `<p:ext uri="{93A30982-65BF-426F-A27A-F356EAA5A948}"><rx:reactions>${groups}</rx:reactions></p:ext>`;
  const rootExtension = `<extLst>${reactionExt(`${reaction('&#x1F44D;', editor.toLowerCase())}${reaction('👍', unknown)}
    ${reaction('🎉', owner)}<rx:rxn type="👋"><rx:instance time="${time}"/></rx:rxn>`)}
    <p:ext uri="{93A30982-65BF-426F-A27A-F356EAA5A949}"><task:taskDetails><task:history>
      ${event(1, '<task:add/>')}
      ${event(2, `<task:asgn authorId="${editor}"/>`)}
      ${event(3, '<task:title val="&lt;b&gt;Finalize&lt;/b&gt;"/>', editor, modernReplyId)}
      ${event(4, '<task:date stDt="2026-11-25T00:00:00Z" endDt="2026-11-30T00:00:00Z"/>', editor)}
      ${event(5, '<task:pcntCmplt val="25000"/>', editor)}
      ${event(6, `<task:undo id="${eventId(5)}"/>`, owner)}
      ${event(7, '<task:unasgnAll/>', unknown)}
      ${event(8, '<task:unknown/>', editor)}
      <task:event time="${time}"><task:atrbtn authorId="${owner}"/><task:add/></task:event>
    </task:history></task:taskDetails></p:ext>
    <p:ext uri="{93A30982-65BF-426F-A27A-F356EAA5A950}">
      <rx:reactions xmlns:rx="urn:test:fake-reactions">${reaction('🚫', editor)}</rx:reactions>
    </p:ext>
  </extLst>`;
  const xml = await zip.file(review)!.async('text');
  zip.file(review, xml.replace('<cmLst xmlns=', `<cmLst xmlns:p="${p}" xmlns:rx="${reactions}" xmlns:task="${tasks}" xmlns=`)
    .replace('</reply></replyLst>', `  <extLst>${reactionExt(reaction('🤝', owner))}</extLst></reply>
      <reply id="${eventId(21)}" authorId="${editor}" created="${time}"><extLst>${reactionExt(reaction('👀', owner))}</extLst></reply>
    </replyLst>`)
    .replace('</cm>', `${rootExtension}</cm>
      <cm id="${eventId(22)}" authorId="${owner}" created="${time}"><unknownAnchor/>
        <extLst>${reactionExt(reaction('❤️', editor))}</extLst>
      </cm>`));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildCommentLocationsFixture(base: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildSlideCommentsFixture(base));
  const drawingCreationId = '{DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD}';
  const ac = 'http://schemas.microsoft.com/office/drawing/2013/main/command';
  const pc = 'http://schemas.microsoft.com/office/powerpoint/2013/main/command';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const slideMoniker = '<pc:sldMk sldId="257"/>';
  const groupMoniker = '<ac:grpSpMk id="900"/>';
  const textMoniker = `<ac:spMk id="999" creationId="${drawingCreationId.toLowerCase()}"/>`;
  const textRange = (hash: number) => `<ac:txMkLst>${slideMoniker}${groupMoniker}${textMoniker}
    <ac:txMk cp="7" len="18"><ac:context len="31" hash="${hash}"/></ac:txMk>
  </ac:txMkLst>`;
  const comments = [
    ['Grouped shapes', `<ac:deMkLst>${slideMoniker}${groupMoniker}</ac:deMkLst>`],
    ['Selected words', textRange(3334988966)],
    ['Outdated text', textRange(1)],
    ['Rotated shape', `<ac:deMkLst>${slideMoniker}${groupMoniker}<ac:spMk id="901"/></ac:deMkLst>`],
    ['On the next slide', `<pc:sldMkLst><pc:sldMk sldId="259" cId="123456"/></pc:sldMkLst>`],
    ['Missing drawing', `<ac:deMkLst>${slideMoniker}<ac:spMk id="999"/></ac:deMkLst>`],
    ['On the slide master', '<ac:deMkLst><pc:sldMasterMk sldMasterId="2147483648"/><ac:spMk id="901"/></ac:deMkLst>']
  ];
  const reviewPart = 'ppt/review/selected.xml';
  const authored = await zip.file(reviewPart)!.async('text');
  zip.file(reviewPart, authored.replace(`<cmLst xmlns=`, `<cmLst xmlns:pc="${pc}" xmlns=`).replace('</cmLst>',
    comments.map(([text, anchor], i) => `<cm id="{33333333-3333-3333-3333-33333333333${i}}"
        authorId="{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}" created="2026-11-26T06:10:00Z">
      ${anchor}<txBody xmlns:a="${a}"><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></txBody>
    </cm>`).join('') + '</cmLst>'));

  const slide2 = 'ppt/slides/slide2.xml';
  const content = await zip.file(slide2)!.async('text');
  zip.file(slide2, content.replace('</p:spTree>', `<p:grpSp>
    <p:nvGrpSpPr><p:cNvPr id="900" name="Review group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="6191250" y="3238500"/><a:ext cx="2286000" cy="1524000"/>
      <a:chOff x="0" y="0"/><a:chExt cx="2286000" cy="1524000"/></a:xfrm></p:grpSpPr>
    <p:sp><p:nvSpPr><p:cNvPr id="901" name="Rotated target"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm rot="1800000"><a:off x="381000" y="0"/><a:ext cx="1143000" cy="571500"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="B5DBF0"/></a:solidFill>
      </p:spPr>
    </p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="902" name="Review text"><a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}">
        <a16:creationId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="${drawingCreationId}"/>
      </a:ext></a:extLst></p:cNvPr><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="857250"/><a:ext cx="2286000" cy="666750"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>
      </p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/>
        <a:p><a:r><a:t xml:space="preserve">Review the </a:t></a:r><a:r><a:rPr b="1"/><a:t>figures</a:t></a:r></a:p>
        <a:p><a:r><a:t>Second line</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
  </p:grpSp></p:spTree>`));
  const slide3 = 'ppt/slides/slide3.xml';
  const target = await zip.file(slide3)!.async('text');
  zip.file(slide3, target.replace('</p:cSld>', `<p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}">
    <p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="123456"/>
  </p:ext></p:extLst></p:cSld>`));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildCommentSourcesFixture(base: Uint8Array, mode: 'single' | 'multiple' = 'single'): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildCommentLocationsFixture(base));
  const part = (name: string) => zip.file(name)!.async('text');
  const master = 'ppt/slideMasters/slideMaster';
  const layout = 'ppt/slideLayouts/slideLayout';
  const masterRels = 'ppt/slideMasters/_rels/slideMaster';
  const layoutRels = 'ppt/slideLayouts/_rels/slideLayout';
  const masterId = '2147483650', layoutId = '2147483651';
  const creation = (id: number) => `<p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}">
    <p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="${id}"/>
  </p:ext></p:extLst>`;
  const group = (await part('ppt/slides/slide2.xml')).match(/<p:grpSp>\s*<p:nvGrpSpPr><p:cNvPr id="900"[\s\S]+?<\/p:grpSp>/)![0];
  const masterGroup = group.replace('Review the ', 'Master has ')
    .replace(/<a:extLst>[\s\S]+?<\/a:extLst>/, '');
  const layoutGroup = masterGroup.replace('Master has ', 'Layout has ');
  zip.file(`${master}2.xml`, (await part(`${master}1.xml`)).replace('name="Master"', 'name="Review master"')
    .replace('</p:spTree>', masterGroup + '</p:spTree>')
    .replace('</p:cSld>', creation(6722) + '</p:cSld>').replace('2147483649', layoutId));
  zip.file(`${masterRels}2.xml.rels`, (await part(`${masterRels}1.xml.rels`)).replace('slideLayout1.xml', 'slideLayout2.xml'));
  zip.file(`${layout}2.xml`, (await part(`${layout}1.xml`)).replace('name="Layout"', 'name="Unused review layout"')
    .replace('</p:spTree>', layoutGroup + '</p:spTree>').replace('</p:cSld>', creation(5533) + '</p:cSld>'));
  zip.file(`${layoutRels}2.xml.rels`, (await part(`${layoutRels}1.xml.rels`)).replace('slideMaster1.xml', 'slideMaster2.xml'));
  zip.file('ppt/presentation.xml', (await part('ppt/presentation.xml')).replace('</p:sldMasterIdLst>',
    `<p:sldMasterId id="${masterId}" r:id="rIdReviewMaster"/></p:sldMasterIdLst>`));
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = 'ppt/_rels/presentation.xml.rels';
  zip.file(rels, (await part(rels)).replace('</Relationships>',
    `<Relationship Id="rIdReviewMaster" Type="${rel}/slideMaster" Target="slideMasters/slideMaster2.xml"/></Relationships>`));
  const types = '[Content_Types].xml';
  zip.file(types, (await part(types)).replace('</Types>', [
    [master, 'slideMaster'], [layout, 'slideLayout']
  ].map(([prefix, type]) => `<Override PartName="/${prefix}2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`).join('') + '</Types>'));

  const masterMk = '<pc:docMk/>' + `<pc:sldMasterMk sldId="${masterId}" cId="6722"/>`;
  const layoutMk = `<pc:sldLayoutMk sldId="${layoutId}" cId="5533"/>`;
  const groupMk = '<ac:grpSpMk id="900"/>';
  const drawing = (path: string, target: string) => `<ac:deMkLst>${path}${target}</ac:deMkLst>`;
  const textRange = (path: string, start: number, length: number) =>
    `<ac:txMkLst>${path}${groupMk}<ac:spMk id="902"/><ac:txMk cp="${start}" len="${length}"/></ac:txMkLst>`;
  const slideMk = (id: number) => `<pc:docMk/><pc:sldMk sldId="${id}"/>`;
  const slide2 = slideMk(257);
  const comments = mode === 'multiple' ? [
    ['Several drawings', drawing(slide2, '<ac:spMk id="999" />') + drawing(slide2, groupMk)
      + drawing(masterMk, groupMk) + drawing(slideMk(258), '<ac:spMk id="2"/>')],
    ['Several text ranges', textRange(slide2, 0, 6) + textRange(masterMk + layoutMk, 11, 7) + textRange(slide2, 11, 7)]
  ] : [
    ['Master review group', drawing(masterMk, groupMk)],
    ['Unused layout text', textRange(masterMk + layoutMk, 11, 7)],
    ['Stale master anchor', drawing(masterMk.replace('6722', '6723'), groupMk)],
    ['Wrong layout owner', drawing(masterMk.replace(`sldId="${masterId}" cId="6722"`, 'sldId="2147483648"') + layoutMk, groupMk)],
    ['Missing master drawing', drawing(masterMk, '<ac:spMk id="11"/>')],
    ['Stale layout anchor', drawing(masterMk + layoutMk.replace('5533', '5534'), groupMk)]
  ];
  const review = 'ppt/review/selected.xml';
  zip.file(review, (await part(review)).replace('</cmLst>', comments.map(([text, anchor], i) =>
    `<cm id="{44444444-4444-4444-4444-44444444444${i}}" authorId="{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}" created="2026-11-26T06:10:00Z">
      ${anchor}<pos x="28575" y="38100"/><txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></txBody>
    </cm>`).join('') + '</cmLst>'));
  return zip.generateAsync({ type: 'uint8array' });
}
