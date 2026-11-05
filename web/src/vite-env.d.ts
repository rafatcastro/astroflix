/// <reference types="vite/client" />

// O build do mammoth para navegador não traz tipos próprios; os do pacote servem.
declare module 'mammoth/mammoth.browser.js' {
  import mammoth from 'mammoth';
  export default mammoth;
}
