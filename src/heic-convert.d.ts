declare module 'heic-convert' {
  function convert(input: {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality: number;
  }): Promise<ArrayBuffer>;
  export default convert;
}
