import {describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./renderPdfPageToPng', () => ({renderPdfFirstPageToPng: vi.fn()}));
import {parseModelJson} from './analyzeDriversLicense';
const valid = {readable: true, number: '123456789', fullName: 'TEST DRIVER', category: 'B', issueDate: '2025-01-01', expirationDate: '2030-01-01'};
describe('license OCR result validation', () => {
  it('rejects a null JSON result safely', () => {expect(parseModelJson('null')).toEqual({status: 'unreadable'});});
  it('preserves the exact expiration date read from a consistent document', () => {
    expect(parseModelJson(JSON.stringify(valid))).toMatchObject({status: 'ok', data: {expirationDate: '2030-01-01'}});
  });
  it.each([
    {issueDate: '2031-01-01'}, {issueDate: '2030-01-01'},
    {expirationDate: '2030-02-30'}, {issueDate: '2025-02-30'},
    {readable: 'true'}, {number: {}}, {fullName: ' '},
  ])('rejects contradictory or malformed reads %j without guessing', (change) => {
    expect(parseModelJson(JSON.stringify({...valid, ...change}))).toEqual({status: 'unreadable'});
  });
});
