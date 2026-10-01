// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Byline } from '../Byline';

/**
 * The line under a title: year, then who, then where. What it has to get right
 * is where one name ends and the next begins, because the sources disagree on
 * whether a name has a comma in it.
 */

const line = (props: Parameters<typeof Byline>[0]) => {
  const { container } = render(<p><Byline {...props} /></p>);
  return container.textContent;
};

afterEach(cleanup);

describe('the byline', () => {
  it('reads year, authors and venue as a sentence', () => {
    expect(line({ year: 2022, authors: ['Ada Lovelace', 'Alan Turing'], venue: 'Nature', shown: 3 }))
      .toBe('2022 by Ada Lovelace and Alan Turing in Nature');
  });

  it('names the shown authors and leaves the rest to et al.', () => {
    expect(line({ authors: ['A One', 'B Two', 'C Three', 'D Four'], shown: 3 }))
      .toBe('By A One, B Two, C Three, et al.');
  });

  it('splits "Last, First" names on semicolons, where commas would split them in half', () => {
    // With commas this read "Doudna, Jennifer, Charpentier, Emmanuelle" — four people.
    expect(line({ year: 2012, authors: ['Doudna, Jennifer', 'Charpentier, Emmanuelle'], shown: 3 }))
      .toBe('2012 by Doudna, Jennifer; Charpentier, Emmanuelle');
    expect(line({ authors: ['Doudna, Jennifer', 'B Two', 'C Three', 'D Four'], shown: 3 }))
      .toBe('By Doudna, Jennifer; B Two; C Three; et al.');
  });

  it('skips a blank name rather than leaving a gap in the list', () => {
    expect(line({ authors: ['Ada Lovelace', '  ', 'Alan Turing'], shown: 3 }))
      .toBe('By Ada Lovelace and Alan Turing');
  });

  it('says nothing when there is nothing to say', () => {
    expect(line({ authors: [], shown: 3 })).toBe('');
  });

  it('links each name to its search', () => {
    const { container } = render(<p><Byline authors={['Jennifer A. Doudna']} venue="eLife" shown={3} /></p>);
    const hrefs = Array.from(container.querySelectorAll('a')).map(a => decodeURIComponent(a.getAttribute('href')!));
    expect(hrefs).toEqual(['/results?q=AU=Jennifer AND AU=Doudna', '/results?q=SO="eLife"']);
  });
});
