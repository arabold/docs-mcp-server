# BGE-M3 dense + sparse + ColBERT: что можно переиспользовать

Дата проверки: 2026-08-09. Рассматривались только первичные репозитории и официальные примеры. Наличие слова `BGE-M3` или поддержки multi-vector само по себе не считалось полноценной реализацией всех трёх режимов.

## Короткий вывод

Для Grounded Docs разумнее всего переиспользовать не один готовый проект, а три проверенные части:

1. **FlagEmbedding** как эталон inference и формул score.
2. **Vespa/pyvespa BGE-M3 notebook** как единственный найденный официальный end-to-end пример, где одновременно хранятся и ранжируются dense, sparse и ColBERT.
3. **Текущий SQLite dense + FTS Grounded** оставить для первого этапа, а ColBERT применять только как late-interaction reranker к top-20/50 кандидатам.

Полностью переносить Vespa или Qdrant внутрь `better-sqlite3` не стоит. Если нужен production-поиск ColBERT по всему корпусу, лучше подключить отдельную Vespa или Qdrant, чем строить собственный multivector-индекс в SQLite.

## Подтверждённые кандидаты

| Проект | Лицензия, язык, активность | Реально реализовано | Что можно взять |
|---|---|---|---|
| [FlagOpen/FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) | MIT; Python/PyTorch; активный main, [v1.4.0](https://github.com/FlagOpen/FlagEmbedding/releases/tag/v1.4.0) | Полный inference BGE-M3: `dense_vecs`, `lexical_weights`, `colbert_vecs`; sparse dot-product; ColBERT MaxSim; взвешенное объединение трёх score | Python inference sidecar, контракт ответа, формулы и golden tests |
| [Vespa BGE-M3 notebook](https://vespa-engine.github.io/pyvespa/examples/mother-of-all-embedding-models-cloud.html) / [pyvespa](https://github.com/vespa-engine/pyvespa) | Apache-2.0; Python + Vespa schema/ranking expressions; активен, [v1.2.4](https://github.com/vespa-engine/pyvespa/releases/tag/v1.2.4) | Настоящий end-to-end full M3: dense ANN, sparse tensor, variable-length ColBERT tensor, normalized MaxSim и общий rank profile | Типы полей, MaxSim expression, fusion `0.4*dense + 0.2*lexical + 0.4*max_sim`, feed/query mapping, deployable Vespa service |
| [Milvus bootcamp: hybrid BGE-M3](https://github.com/milvus-io/bootcamp/blob/master/tutorials/quickstart/hybrid_search_with_milvus.ipynb) / [Milvus](https://github.com/milvus-io/milvus) | Apache-2.0; Python/Go/C++; bootcamp и Milvus активны, Milvus [v3.0.0](https://github.com/milvus-io/milvus/releases/tag/v3.0.0) | **Только dense+sparse**: `FLOAT_VECTOR`, `SPARSE_FLOAT_VECTOR`, два ANN request и `WeightedRanker`/RRF. ColBERT в этом pipeline нет | Sparse schema/index, запросы dense+sparse, RRF/weighted fusion, контейнер Milvus. Не брать как доказательство full M3 |
| [Qdrant](https://github.com/qdrant/qdrant) | Apache-2.0; Rust, официальные JS/Python clients; активен, [v1.19.0](https://github.com/qdrant/qdrant/releases/tag/v1.19.0) | Production primitives: named dense vectors, sparse vectors, multivectors с `max_sim`, prefetch и fusion/RRF. В официальном репозитории не найден готовый BGE-M3 encoder-to-three-fields pipeline | Готовый storage/search service, multivector MaxSim, quantization, filtering, fusion API; inference всё равно нужен отдельно |
| [Infinity](https://github.com/michaelfeil/infinity) и [TEI](https://github.com/huggingface/text-embeddings-inference) | Infinity MIT/Python, [0.0.77](https://github.com/michaelfeil/infinity/releases/tag/0.0.77); TEI Apache-2.0/Rust, [v1.9.3](https://github.com/huggingface/text-embeddings-inference/releases/tag/v1.9.3) | Не подтверждены как full M3 server. Infinity прямо перечисляет `BAAI/bge-m3, no sparse`; TEI содержит BGE-M3 tokenization/model support, но найденный публичный API не выдаёт одновременно dense+sparse+ColBERT | Можно использовать как dense inference infrastructure, но не как готовый full M3 backend |

## 1. FlagEmbedding: эталон, который стоит переиспользовать

Официальная [BGE-M3 документация](https://github.com/FlagOpen/FlagEmbedding/tree/master/research/BGE_M3) показывает один вызов:

```python
model.encode(
    texts,
    return_dense=True,
    return_sparse=True,
    return_colbert_vecs=True,
)
```

Результат содержит три независимых представления:

- `dense_vecs`: один нормированный вектор размерности 1024;
- `lexical_weights`: разреженная карта `token_id -> weight`;
- `colbert_vecs`: переменное число нормированных 1024-мерных token vectors.

Полезный исходный код:

- [inference class и обработка всех трёх выходов](https://github.com/FlagOpen/FlagEmbedding/blob/master/FlagEmbedding/inference/embedder/encoder_only/m3.py);
- [официальные inference examples](https://github.com/FlagOpen/FlagEmbedding/tree/master/examples/inference/embedder/encoder_only);
- [evaluation pipelines для dense/sparse/multivector](https://github.com/FlagOpen/FlagEmbedding/tree/master/research/C_MTEB).

Формулы из официального кода:

```text
sparse(q,d) = sum(weight_q[token] * weight_d[token]) по общим token_id
colbert(q,d) = mean_i(max_j(dot(q_token_i, d_token_j)))
combined = (wd*dense + ws*sparse + wc*colbert) / (wd+ws+wc)
```

Это наиболее безопасная часть для прямого заимствования логики и тестовых примеров. Сам Python/PyTorch код нельзя разумно перенести в Node построчно: модель, tokenizer и CUDA execution остаются Python-native.

## 2. Vespa: лучший полный end-to-end референс

Официальный [BGE-M3 Vespa notebook](https://vespa-engine.github.io/pyvespa/examples/mother-of-all-embedding-models-cloud.html) действительно проходит весь путь:

- вызывает `BGEM3FlagModel` со всеми тремя `return_*`;
- хранит sparse как mapped tensor `tensor<bfloat16>(t{})`;
- хранит dense как `tensor<bfloat16>(x[1024])`;
- хранит ColBERT как variable-length mixed tensor `tensor<bfloat16>(t{},x[1024])`;
- извлекает кандидатов через text matching и dense nearest-neighbor;
- вычисляет sparse dot product и ColBERT MaxSim;
- нормализует MaxSim на число query token vectors;
- объединяет `0.4*dense + 0.2*lexical + 0.4*max_sim`.

Именно отсюда стоит взять schema/ranking semantics. Вес `0.4/0.2/0.4` — стартовая конфигурация примера, а не универсальный оптимум: его нужно подобрать на нашем benchmark.

Production-готовность высокая, если принять Vespa как отдельный поисковый сервис. Но добавлять Vespa только для 6–7 тысяч chunks может быть слишком тяжело операционно.

## 3. Milvus: хороший dense+sparse, но не full M3

Официальный [Milvus BGE-M3 hybrid tutorial](https://github.com/milvus-io/bootcamp/blob/master/tutorials/quickstart/hybrid_search_with_milvus.ipynb) использует `pymilvus.model.hybrid.BGEM3EmbeddingFunction`, два поля и два индекса:

- dense `FLOAT_VECTOR` с IP/COSINE;
- sparse `SPARSE_FLOAT_VECTOR` с inverted index;
- два `AnnSearchRequest`;
- `WeightedRanker` или RRF.

Его удобно использовать как образец API и тестов для двухканального поиска. Он не решает хранение или scoring ColBERT, поэтому не заменяет Vespa notebook.

## 4. Qdrant: лучший отдельный storage, но encoder надо соединить самим

Qdrant предоставляет нужные примитивы: [multivectors](https://qdrant.tech/documentation/concepts/vectors/#multivectors), [sparse vectors](https://qdrant.tech/documentation/concepts/vectors/#sparse-vectors) и [hybrid queries/fusion](https://qdrant.tech/documentation/concepts/hybrid-queries/). Для ColBERT поддерживается comparator `max_sim`; named vectors позволяют положить dense и ColBERT рядом, sparse хранится отдельным named sparse field.

Практический pipeline:

1. Python sidecar возвращает dense, sparse и ColBERT.
2. TypeScript клиент пишет их в одну Qdrant point с `document_id` и library/version payload.
3. Dense+sparse prefetch формирует кандидатов и объединяется RRF/DBSF.
4. ColBERT multivector применяется как поздний ranking stage.

Это production-готовый путь для больших корпусов. Переиспользовать следует контейнер и официальный JS client, а не копировать Rust storage engine в проект.

## Почему нужен Python inference sidecar

Рекомендуемый контракт:

```json
POST /v1/bge-m3/encode
{
  "kind": "query | document",
  "texts": ["..."],
  "maxLength": 512,
  "modes": ["dense", "sparse", "colbert"]
}
```

```json
{
  "items": [{
    "dense": [0.1],
    "sparse": {"indices": [42], "values": [0.27]},
    "colbert": [[0.1]],
    "tokenCount": 123
  }],
  "model": "BAAI/bge-m3"
}
```

Преимущества sidecar:

- используется официальный `FlagEmbedding`, tokenizer и CUDA batching;
- формулы можно сверять с upstream golden values;
- Node 22 остаётся координатором, а не ML runtime;
- backend можно позже заменить на managed full-M3 API без изменения store contract.

## Минимальная доработка Grounded Docs

### Рекомендуемый первый этап: ColBERT только как reranker

1. Добавить интерфейс `MultiRepresentationEmbeddings`, не ломая текущий LangChain `Embeddings`.
2. При индексации продолжать хранить dense в `documents_vec` и текст в FTS5.
3. Не хранить ColBERT для всего корпуса; sidecar кодирует запрос и тексты top-20/50 после текущего RRF.
4. Рассчитать MaxSim и объединить score либо применить ColBERT как последнюю сортировку.
5. Добавить настройки candidate count, max passage length, weights и fail-open: при недоступном sidecar возвращать нынешний dense+FTS результат.
6. Добавить E2E fixture с фиксированными outputs sidecar и regression benchmark.

Это минимальный риск и самый короткий способ проверить, даёт ли ColBERT пользу именно на книгах 1С.

### Второй этап: хранить sparse BGE-M3

Не заменять FTS5 сразу. Создать таблицу вида:

```sql
CREATE TABLE document_sparse_terms (
  document_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (document_id, token_id)
);
CREATE INDEX document_sparse_terms_token_idx
  ON document_sparse_terms(token_id);
```

Sparse score — сумма произведений весов по совпавшим token IDs. После benchmark сравнить BGE sparse с текущим FTS5/BM25; хранить оба канала постоянно стоит только при измеримом улучшении.

### Третий этап: persistent ColBERT

Для полного persistent late-interaction выбрать Qdrant или Vespa. Собственная SQLite-реализация оправдана только как небольшой rerank cache, а не как новый индекс.

## Риски хранения ColBERT

- BGE-M3 даёт 1024 float на почти каждый token: float32 требует около 4 KiB на token, bfloat16 — около 2 KiB.
- Chunk на 256 token занимает примерно 1 MiB в float32; 6 631 таких chunks — порядка 6.5 GiB только сырых token vectors, без индексов и служебных данных.
- JSON в SQLite заметно увеличит объём и CPU; нужны binary blobs либо внешний multivector store.
- Exact MaxSim стоит `O(query_tokens * document_tokens * 1024)` на кандидата. Его нельзя считать по всему корпусу обычным TypeScript loop.
- Длинные chunks резко повышают и память, и latency; нужен отдельный `maxPassageLength` для ColBERT.
- Квантизация экономит место, но требует отдельной проверки потери качества на русском корпусе.
- Смена tokenizer/model revision инвалидирует sparse token IDs и ColBERT vectors; metadata должна хранить model revision и параметры truncation.

## Итоговый shortlist

1. **Начать с FlagEmbedding sidecar + ColBERT rerank top-30 поверх текущего Grounded RRF.** Это лучший баланс качества, сложности и обратимости.
2. **Взять из Vespa notebook формулу MaxSim, tensor mapping и стартовые веса**, но сначала реализовать scoring в sidecar, без установки Vespa.
3. **Если benchmark подтвердит прирост и corpus вырастет — Qdrant** как более простой отдельный dense+sparse+multivector store для существующего TypeScript приложения.
4. **Vespa** выбирать, если нужен единый production ranking engine с формулами и phased ranking, и допустима более тяжёлая эксплуатация.
5. **Milvus** использовать только как reference для dense+sparse fusion. **Infinity/TEI** не брать как full-M3 backend.
