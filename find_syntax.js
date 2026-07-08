const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');

function scan() {
  let i = 0;
  let line = 1;
  let stack = [];
  let inLineComment = false;
  let inBlockComment = false;
  let inString = null;
  let escape = false;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        line++;
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      if (ch === '\n') line++;
      i++;
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === inString) {
        inString = null;
      } else if (ch === '\n') {
        line++;
      }
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i++;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({ ch, line });
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop();
      if (!top) {
        console.log('extra closing', ch, 'at line', line);
        return;
      }
    }

    if (ch === '\n') line++;
    i++;
  }

  console.log('remaining opens', stack.slice(-20));
  console.log('line count', line);
}

try {
  scan();
} catch (err) {
  console.error(err.stack);
  process.exit(1);
}
