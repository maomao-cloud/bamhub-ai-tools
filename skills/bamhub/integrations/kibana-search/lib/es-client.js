export function createEsClient() {
  return {
    available: false,
    async search() {
      throw new Error('QUERY_BACKEND_UNAVAILABLE:es');
    }
  };
}
