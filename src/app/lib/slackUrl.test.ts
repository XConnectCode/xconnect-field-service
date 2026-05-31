import { parseSlackUrl } from './slackUrl';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok:', msg);
}

// JSON-wrapped real URL → extracts the Url
assert(
  parseSlackUrl('{"Url":"https://xconnecthq.slack.com/archives/C02CST5QZC3/p1777573054354709","LinkText":"https://x"}')
    === 'https://xconnecthq.slack.com/archives/C02CST5QZC3/p1777573054354709',
  'extracts Url from JSON blob'
);

// Empty JSON object → ''
assert(parseSlackUrl('{"Url":"","LinkText":""}') === '', 'empty JSON object returns empty');

// Bare URL → passthrough
assert(parseSlackUrl('https://slack.com/x') === 'https://slack.com/x', 'bare https URL passthrough');

// Non-url junk → ''
assert(parseSlackUrl('not a url') === '', 'non-url returns empty');

// null / undefined / blank → ''
assert(parseSlackUrl(null) === '', 'null returns empty');
assert(parseSlackUrl(undefined) === '', 'undefined returns empty');
assert(parseSlackUrl('   ') === '', 'blank returns empty');

// Empty Url with non-empty LinkText → '' (nullish-coalescing: empty string is
// kept, not replaced — matches the original IncidentDetail behavior).
assert(
  parseSlackUrl('{"Url":"","LinkText":"https://slack.com/t"}') === '',
  'empty Url is not overridden by LinkText'
);

// Missing Url key falls back to LinkText
assert(
  parseSlackUrl('{"LinkText":"https://slack.com/t"}') === 'https://slack.com/t',
  'missing Url key falls back to LinkText'
);

console.log('done');
