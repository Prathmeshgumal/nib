import { describe, expect, it } from 'vitest';
import { delimiterFor, parse } from './csv';

describe('parse', () => {
  it('reads plain rows', () => {
    expect(parse('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('does not invent a row from the trailing newline', () => {
    expect(parse('a,b\n')).toEqual([['a', 'b']]);
  });

  it('keeps a last row that has no newline after it', () => {
    expect(parse('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps commas inside a quoted field', () => {
    expect(parse('name,note\n"Doe, Jane",hi\n'))
      .toEqual([['name', 'note'], ['Doe, Jane', 'hi']]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(parse('a,b\n"one\ntwo",3\n')).toEqual([['a', 'b'], ['one\ntwo', '3']]);
  });

  it('reads a doubled quote as one literal quote', () => {
    expect(parse('a\n"she said ""hi"""\n')).toEqual([['a'], ['she said "hi"']]);
  });

  it('keeps empty fields, including at the end of a row', () => {
    expect(parse('a,,c\n1,2,\n')).toEqual([['a', '', 'c'], ['1', '2', '']]);
  });

  it('handles Windows line endings', () => {
    expect(parse('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('strips the byte-order mark Excel writes', () => {
    expect(parse('﻿a,b\n')).toEqual([['a', 'b']]);
  });

  it('returns nothing for an empty file', () => {
    expect(parse('')).toEqual([]);
  });

  it('splits on tabs when asked to', () => {
    expect(parse('a\tb\n1\t2\n', '\t')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('delimiterFor', () => {
  it('uses a tab only for .tsv', () => {
    expect(delimiterFor('report.tsv')).toBe('\t');
    expect(delimiterFor('report.TSV')).toBe('\t');
    expect(delimiterFor('report.csv')).toBe(',');
    expect(delimiterFor('')).toBe(',');
  });
});
