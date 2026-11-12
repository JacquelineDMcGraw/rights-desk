"""Read the visible body of a local EML file with the Python standard library."""

from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
import re
import sys


BLOCK_TAGS = {
    'address', 'article', 'br', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'li', 'p', 'pre', 'section', 'table', 'td', 'tr',
}
HIDDEN_TAGS = {'blockquote', 'head', 'noscript', 'script', 'style', 'svg', 'template'}
VOID_TAGS = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
QUOTE_CLASSES = {'gmail_quote', 'moz-cite-prefix', 'yahoo_quoted'}
QUOTE_MARKER = re.compile(r'^\s*(?:-{2,}\s*(?:original|forwarded) message\s*-{2,}|begin forwarded message:)\s*$', re.I)
REPLY_HEADER = re.compile(r'^\s*On[ \t].{1,350}(?:\n.{1,350}){0,2}\bwrote:[ \t]*$', re.I)


class BodyText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = []
        self.finished = False

    def handle_starttag(self, tag, attrs):
        if self.finished:
            return
        if self.hidden:
            if tag not in VOID_TAGS:
                self.hidden.append(tag)
            return
        attributes = dict(attrs)
        classes = set((attributes.get('class') or '').split())
        if (attributes.get('id') or '').lower() == 'divrplyfwdmsg':
            self.finished = True
        elif tag in HIDDEN_TAGS or classes & QUOTE_CLASSES or 'hidden' in attributes:
            if tag not in VOID_TAGS:
                self.hidden.append(tag)
        elif tag in BLOCK_TAGS:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if self.finished:
            return
        if self.hidden:
            if tag in self.hidden:
                while self.hidden.pop() != tag:
                    pass
        elif tag in BLOCK_TAGS:
            self.parts.append('\n')

    def handle_data(self, text):
        if not self.finished and not self.hidden:
            self.parts.append(re.sub(r'\s+', ' ', text))


def current_reply(text):
    lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    body = []
    for index, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith('>'):
            continue
        if line == '-- ' or QUOTE_MARKER.fullmatch(line):
            break
        if stripped.lower().startswith('on ') and any(
            REPLY_HEADER.fullmatch('\n'.join(lines[index:index + count])) for count in (1, 2, 3)
        ):
            break
        if stripped.lower().startswith('from:') and index + 1 < len(lines):
            if lines[index + 1].lstrip().lower().startswith(('sent:', 'date:')):
                break
        body.append(line.rstrip())
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(body)).strip()


def extract_body(message):
    for kind in ('plain', 'html'):
        part = message.get_body(preferencelist=(kind,))
        if part is None or part.get_filename():
            continue
        try:
            text = part.get_content()
        except LookupError:
            payload = part.get_payload(decode=True)
            text = payload.decode('utf-8', errors='replace') if payload else ''
        if not isinstance(text, str):
            continue
        if kind == 'html':
            reader = BodyText()
            reader.feed(text)
            reader.close()
            text = ''.join(reader.parts)
        body = current_reply(text)
        if body:
            return body
    return ''


def main(path, max_bytes, max_text):
    with open(path, 'rb') as stream:
        contents = stream.read(max_bytes + 1)
    if len(contents) > max_bytes:
        return 3
    message = BytesParser(policy=policy.default).parsebytes(contents)
    text = extract_body(message)
    if not text:
        return 2
    if len(text) > max_text:
        return 3
    sys.stdout.buffer.write(text.encode('utf-8', errors='replace'))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3])))
    except (OSError, ValueError, RecursionError):
        sys.exit(2)
