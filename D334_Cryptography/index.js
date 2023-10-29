(async function () {
  const fs = await import('fs');
  const path = await import('path');
  const showdown = require('./showdown');
  showdown.setFlavor('github');
  const converter = new showdown.Converter({ tables: true, tasklist: true });
  // converter.makeHtml(textBlock) // returns html.

  async function invoke(action, params = {}) {
    // will return object with result and error field when error.
    try {
      const res = await fetch('http://127.0.0.1:8765', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, version: 1, params }),
      });
      const data = await res.json();
      if (!res.ok) throw 'Fetch failed to get response. Is Anki Connect listening?';
      if (data.error) throw data;
      return data;
    } catch (e) {
      console.log('Error: ', e);
    }
  }

  // START HERE!
  const data = fs.readFileSync('Cryptography.md', 'utf-8');
  const deckName = 'WGU_D334_Intro_to_Cryptography';
  const sections = await parsePage(data);
  // console.log(JSON.stringify(sections, null, 2));

  // create deck
  await invoke('createDeck', { deck: deckName });
  // loop each section and add to anki.
  // {section, text: [{front, back, picture}] }
  for (const { section, text } of sections) {
    const sectionName = section.replaceAll(' ', '_').trim();
    // create subDeck
    await invoke('createDeck', { deck: `${deckName}::${sectionName}` });
    // add text array
    for (const { front, back, picture } of text) {
      await invoke('addNote', {
        note: {
          deckName: `${deckName}::${sectionName}`,
          modelName: 'Basic',
          fields: {
            Front: front,
            Back: back,
          },
          picture,
        },
      });
    }
  }
  //
  //
  // START Functions
  // separate page into sections.
  async function parsePage(data) {
    // remove first 68 lines
    const dataStr = data.split(/\r?\n/).slice(68).join('\n');
    // separate page into blocks
    const blocks = dataStr.match(/[^#]*/g).filter((line) => line.length > 0);
    // console.log(blocks);
    // console.log(blocks.length);

    // returns object with {section, text}
    const sections = blocks.map((block) => processBlocks(block));
    return sections;
  }
  //
  // need object with {section, text: {front, back, picture}}
  function processBlocks(block) {
    // get and remove section name
    const [s, ...rest] = block.split(/\r?\n/).filter((line) => line.length > 0);
    let section = s?.trim() ?? 'Section';
    // create section blocks
    const sectionBlocks = rest
      .join('\n')
      .match(/[^;]*/g)
      .filter((line) => line.length > 4);
    // console.log(sectionBlocks.length);

    const text = [];
    // format each section
    sectionBlocks.forEach((lineBlock) => {
      let front = '';
      let back = '';
      const picture = [];
      // check each line if an image.
      // separate key, value
      // only split first line, due to tables having ':' in them.
      const [firstLine, ...rest] = lineBlock?.trim().split(/\r?\n/);
      const [key, v] = firstLine?.trim().split(':');
      front = '<h2>' + key.replaceAll('*', '').replace('-', '')?.trim() + '</h2>';
      // backside of card.
      const value = v?.trim() ? v + '\n' : '' + rest?.join('\n') || '';
      // const value = confirm.makeHtml(v?.trim() ? v + '\n' : '' + rest?.join('\n') || '');
      // loop each line, remove image line, push image object to picture.
      let textNoImages = '';
      value.split(/\r?\n/).forEach((line) => {
        // discard empty lines
        if (line.length < 1) return;
        // check if line is an image.
        if (/.*!\[(.*)\]\((.*)\)/.test(line)) {
          const picPath = markdownParser(line);
          const filename = picPath.split('/').pop();
          const newPic = path.join(process.cwd(), 'img', filename);

          picture.push({
            path: newPic,
            filename,
            fields: ['Back'],
          });
          return;
        }
        textNoImages += line.trim() + '\n'; // take out the bullet indents.
      });
      back = converter.makeHtml(textNoImages);
      text.push({ front, back, picture });
    });
    // console.log(text);
    return { section, text };
  }
  // parse markdown line of text and return html.
  function markdownParser(line) {
    // check if line is startsWith '-'.
    if (line.trim().startsWith('-')) {
      // preserve the whitespace or tabs. Do not trim start of line.
      const newline = line
        .replace(/^(\s*)-/, '$1\u2022') // bullet point
        .trimEnd();
      return markdownToHTML(newline);
    }
    // check if heading
    if (/^#+/.test(line.trim())) {
      const heading = line
        .replace(/^##### (.*$)/gim, '<h5>$1</h5>') // h5 tag
        .replace(/^#### (.*$)/gim, '<h4>$1</h4>') // h4 tag
        .replace(/^### (.*$)/gim, '<h3>$1</h3>') // h3 tag
        .replace(/^## (.*$)/gim, '<h2>$1</h2>') // h2 tag
        .replace(/^# (.*$)/gim, '<h1>$1</h1>') // h1 tag
        .trim();
      return markdownToHTML(heading);
    } else {
      return markdownToHTML(line);
    }

    function markdownToHTML(line) {
      return line
        .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>') // bold line
        .replace(/\*(.*)\*/gim, '<i>$1</i>') // italic line
        .replace(/.*!\[.*\]\((.*)\)/, '$1') // image. return path.
        .replace(/\[(.*?)\]\((.*?)\)/gim, "<a href='$2'>$1</a>"); // link
    }
  }
  // parse block of markdown line and return html table
  function extractTable(tableBlock) {
    const tableArr = tableBlock.split(/\r?\n/);
    let table = '';
    let tableStr = '';
    let isTable = false;
    let isTableEnd = false;
    const size = tableArr.length;
    tableArr.forEach((line, i) => {
      // console.log(/\|[\w \W]*\|[\w \W]*\|/.test(line))
      // check each line for table markup
      const lineIsTable = /\|[\w \W]*\|[\w \W]*\|/.test(line);
      if (lineIsTable) {
        tableStr += line.trim() + '\n';
        isTable = true;
      }
      // check if table has ended.
      if (isTable && (!lineIsTable || i === size - 1)) {
        isTableEnd = true;
        isTable = false;
      }
      // after table end process table.
      if (!isTable && isTableEnd) {
        isTableEnd = false;
        table = processTable(tableStr);
      }
    });
    return table;
    function processTable(table) {
      let tableHTML = '<table>';
      const tableArr = table.split(/\r?\n/);
      const [h, a, ...rest] = tableArr;
      const alignment = checkAlignment(a); // left|center|right
      // header
      tableHTML += lineToHTML(h, alignment, true);
      // body
      rest.forEach((line) => {
        tableHTML += lineToHTML(line, alignment, false);
      });
      return tableHTML;

      function lineToHTML(line, align = 'left', isHeader = false) {
        let row = '<tr>';
        const type = isHeader ? 'th' : 'td';
        const style = `style='text-align: ${align}'`;
        row += `<${type} ${style}>`;
        const rowData = line
          .split('|')
          .map((data) => data.trim())
          .slice(1, -1);
        rowData.forEach((d) => (row += `<${type} ${style}>${d}</${type}>`));
        row += `</tr>`;
        return row;
      }
      function checkAlignment(line) {
        const alignment = line.replace(/\|/g, '').trim();
        if (alignment.startsWith(':') && alignment.endsWith(':')) return 'center';
        if (alignment.endsWith(':')) return 'right';
        return 'left';
      }
    }
  }
})();