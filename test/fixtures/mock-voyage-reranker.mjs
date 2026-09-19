const nativeFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  if (String(input) !== "https://api.voyageai.com/v1/rerank") {
    return nativeFetch(input, init);
  }

  console.log("TEST_RERANK_CALLED");
  const request = JSON.parse(String(init?.body));
  return new Response(
    JSON.stringify({
      data: request.documents.map((_, index) => ({
        index,
        relevance_score: 1 - index / 100,
      })),
      usage: { total_tokens: 7 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};
