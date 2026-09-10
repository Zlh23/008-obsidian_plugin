function tasks(text) {
  return text.split(/\r?\n/).flatMap((line, lineNumber) => {
    const match = line.match(/^\s*(?:>\s*)?\|\s*- \[([ xX])\]\s*\|\s*([^|]+)/);
    return match ? [{ line: lineNumber, label: match[2].trim() || '测试项', done: match[1].toLowerCase() === 'x' }] : [];
  });
}

function methods(text) {
  const lines = text.split(/\r?\n/), result = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^>\s*\[!usb-method\]-\s*`([^`]+)`/);
    if (!match) continue;
    const end = lines.findIndex((line, i) => i > index && /^>\s*\[!usb-method\]-/.test(line));
    const section = lines.slice(index, end < 0 ? lines.length : end).join('\n');
    const checks = tasks(section);
    result.push({ line: index, label: match[1], done: checks.length > 0 && checks.every((item) => item.done) });
  }
  return result;
}


module.exports = { tasks, methods };
