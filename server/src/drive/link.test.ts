import { describe, expect, it } from 'vitest';
import { parseLinkArquivoOuPastaDrive, parseLinkDrive } from './link';

const ID = '1agQg1fIAst2WYhAXtYyTf1wDhGBR73D_';

describe('parseLinkDrive', () => {
  it.each([
    ['link de pasta', `https://drive.google.com/drive/folders/${ID}`],
    ['link de pasta com parâmetros de compartilhamento', `https://drive.google.com/drive/folders/${ID}?usp=sharing`],
    ['link de pasta com conta /u/1', `https://drive.google.com/drive/u/1/folders/${ID}`],
    ['link antigo com open?id=', `https://drive.google.com/open?id=${ID}`],
    ['id puro com espaços em volta', `   ${ID}  `],
  ])('reconhece %s', (_, texto) => {
    expect(parseLinkDrive(texto)).toEqual({ folderId: ID, resourceKey: null });
  });

  it('lê resourcekey quando o link traz', () => {
    expect(parseLinkDrive(`https://drive.google.com/drive/folders/${ID}?resourcekey=0-abc`)).toEqual({
      folderId: ID,
      resourceKey: '0-abc',
    });
  });

  it.each([
    ['arquivo, e não pasta', `https://drive.google.com/file/d/${ID}/view`],
    ['documento do Docs', `https://docs.google.com/document/d/${ID}`],
    ['outro host com o mesmo caminho', `https://exemplo.com/folders/${ID}`],
    ['texto vazio', ''],
  ])('recusa %s', (_, texto) => {
    expect(parseLinkDrive(texto)).toBeNull();
  });
});

describe('parseLinkArquivoOuPastaDrive', () => {
  it('aceita link de arquivo, de pasta e id puro', () => {
    expect(parseLinkArquivoOuPastaDrive(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toEqual({ id: ID, resourceKey: null });
    expect(parseLinkArquivoOuPastaDrive(`https://drive.google.com/file/u/1/d/${ID}/view?resourcekey=0-abc`)).toEqual({ id: ID, resourceKey: '0-abc' });
    expect(parseLinkArquivoOuPastaDrive(`https://drive.google.com/drive/folders/${ID}`)).toEqual({ id: ID, resourceKey: null });
    expect(parseLinkArquivoOuPastaDrive(ID)).toEqual({ id: ID, resourceKey: null });
  });
  it('recusa outro host', () => {
    expect(parseLinkArquivoOuPastaDrive(`https://drive.google.com.exemplo.com/file/d/${ID}/view`)).toBeNull();
  });
});
