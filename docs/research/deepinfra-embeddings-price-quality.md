# DeepInfra embeddings: цена, качество и совместимость с Grounded Docs v3

Дата проверки: **2026-08-09**.

## Короткий вывод

Для русскоязычного RAG в текущем Grounded Docs v3 наиболее безопасный выбор из каталога DeepInfra — **`BAAI/bge-m3`**. Модель поддерживает русский, 8192 токена и 1024-мерный dense-вектор; для dense retrieval ей не нужны разные префиксы для запроса и документа. Цена DeepInfra — **$0.010 за 1 млн входных токенов**.

Однако прямое подключение следует сначала проверить одним API-запросом: native schema DeepInfra для этой модели объявляет `normalize: false` по умолчанию, а OpenAI-compatible route не дает Grounded передать `normalize`. Grounded ранжирует через SQLite-vec по L2. L2 эквивалентен cosine только для L2-нормированных векторов. Если фактические ответы `/v1/openai/embeddings` не нормированы, понадобится либо нормализация в адаптере, либо изменение метрики; одной смены URL будет недостаточно.

`BAAI/bge-m3-multi` — не «улучшенная dense-модель». Это отдельный endpoint той же BGE-M3 с dense, sparse и ColBERT-выходами. Его OpenAI-compatible режим может вернуть обычный dense-вектор, но Grounded не умеет использовать sparse/ColBERT, поэтому преимуществ перед `BAAI/bge-m3` без доработки нет.

## Методика и ограничения

- Состав, цены, контекст, статус и OpenAI-tag взяты из текущих данных страницы [DeepInfra Embeddings](https://deepinfra.com/models/embeddings). В embedded-каталоге 30 записей: 27 действующих и 3 deprecated batch-варианта Qwen. На первой серверной странице визуально отрисованы только 24 карточки; еще `shibing624/text2vec-base-chinese`, `thenlper/gte-base` и `thenlper/gte-large` находятся в том же официальном массиве каталога.
- Цена вычислена из `pricing.cents_per_input_token` и совпадает с ценой на карточках: доллары за 1 млн входных токенов. Цена может измениться.
- Размерности и правила формирования входа сверены с официальными model cards авторов для multilingual-кандидатов: [BGE-M3](https://huggingface.co/BAAI/bge-m3), [Qwen3 Embedding](https://huggingface.co/Qwen/Qwen3-Embedding-8B), [EmbeddingGemma](https://huggingface.co/google/embeddinggemma-300m), [multilingual-e5-large](https://huggingface.co/intfloat/multilingual-e5-large), [multilingual-e5-large-instruct](https://huggingface.co/intfloat/multilingual-e5-large-instruct), [Nemotron 3 Embed 1B](https://huggingface.co/nvidia/Nemotron-3-Embed-1B-BF16), [Llama Nemotron Embed VL](https://huggingface.co/nvidia/llama-nemotron-embed-vl-1b-v2).
- Benchmark-цифры разных model cards не сведены в один рейтинг: различаются датасеты, версии MTEB/RTEB, инструкции, pooling и размерность. Для выбора на книгах 1С нужен одинаковый локальный eval.
- «Без доработок» означает: LangChain `OpenAIEmbeddings`, одинаковый plain `input` при индексации и поиске, один dense float-вектор и SQLite-vec L2. Transport-compatible не всегда означает оптимальное качество.

## Полный актуальный каталог

Обозначения совместимости: **да** — пригодна в текущей схеме; **условно** — API работает, но теряется рекомендованный prompt/input type или надо подтвердить норму вектора; **нет** — модель/режим предназначены для другой задачи либо требуют разного формирования query/document.

| Model ID | $ / 1M | Размерность | Контекст | Языки / русский | Вход, метрика и совместимость с Grounded |
|---|---:|---:|---:|---|---|
| [`BAAI/bge-base-en-v1.5`](https://deepinfra.com/BAAI/bge-base-en-v1.5) | 0.005 | 768 | 512 | English; нет | Retrieval instruction рекомендуется для query; cosine/нормализация. **Нет** для русского. |
| [`BAAI/bge-en-icl`](https://deepinfra.com/BAAI/bge-en-icl) | 0.010 | 4096 | 8192 | English; нет | ICL/query prompt — часть сильного режима. **Нет** для русского. |
| [`BAAI/bge-large-en-v1.5`](https://deepinfra.com/BAAI/bge-large-en-v1.5) | 0.010 | 1024 | 512 | English; нет | Query instruction рекомендуется; cosine. **Нет** для русского. |
| [`BAAI/bge-m3`](https://deepinfra.com/BAAI/bge-m3) | 0.010 | 1024 | 8192 | 100+; **русский есть** | Dense не требует query/passsage prefix. Model card использует нормированные embeddings; DeepInfra native default — `normalize=false`, поэтому прямой OpenAI route надо измерить. **Да, после проверки нормы**. |
| [`BAAI/bge-m3-multi`](https://deepinfra.com/BAAI/bge-m3-multi) | 0.010 | 1024 dense + sparse + token vectors | 8192 | 100+; **русский есть** | Native API умеет dense/sparse/ColBERT; Grounded возьмет только dense. **Условно**, без выигрыша относительно `bge-m3`. |
| [`Qwen/Qwen3-Embedding-0.6B`](https://deepinfra.com/Qwen/Qwen3-Embedding-0.6B) | 0.010 | 1024, MRL | 32768 | 100+; **русский есть** | Авторы рекомендуют instruction только для query; документы без instruction. Plain input работает, но теряет заявленные 1–5%. Нормированные векторы. **Условно**. |
| [`Qwen/Qwen3-Embedding-4B`](https://deepinfra.com/Qwen/Qwen3-Embedding-4B) | 0.020 | 2560, MRL | 32768 | 100+; **русский есть** | То же разделение query/document. **Условно**; при текущей цене хуже по value, чем 8B. |
| [`Qwen/Qwen3-Embedding-8B`](https://deepinfra.com/Qwen/Qwen3-Embedding-8B) | 0.010 | 4096, MRL | 32768 | 100+; **русский есть** | То же разделение query/document. **Условно**; transport совместим, оптимальный retrieval требует адаптер. |
| [`google/embeddinggemma-300m`](https://deepinfra.com/google/embeddinggemma-300m) | 0.002 | 768, MRL | 2048 | 100+; **русский есть** | Retrieval prompts различаются: query и document имеют разные шаблоны. Cosine/нормализация. **Нет без адаптера**. |
| [`intfloat/e5-base-v2`](https://deepinfra.com/intfloat/e5-base-v2) | 0.005 | 768 | 512 | English; нет | Обязательны `query:` / `passage:`; cosine. **Нет**. |
| [`intfloat/e5-large-v2`](https://deepinfra.com/intfloat/e5-large-v2) | 0.010 | 1024 | 512 | English; нет | Обязательны `query:` / `passage:`; cosine. **Нет**. |
| [`intfloat/multilingual-e5-large`](https://deepinfra.com/intfloat/multilingual-e5-large) | 0.010 | 1024 | 512 | 100; **русский есть** | Обязательны `query:` / `passage:`. **Нет без адаптера**. |
| [`intfloat/multilingual-e5-large-instruct`](https://deepinfra.com/intfloat/multilingual-e5-large-instruct) | 0.010 | 1024 | 512 | 100; **русский есть** | Query требует task instruction; document остается plain. **Нет без адаптера**. |
| [`nvidia/Nemotron-3-Embed-1B-BF16`](https://deepinfra.com/nvidia/Nemotron-3-Embed-1B-BF16) | 0.015 | 2048, MRL | 32768 | 34; **русский есть** | Авторы требуют `query:` / `passage:`; embeddings L2-normalized. **Нет без адаптера**. |
| [`nvidia/Nemotron-3-Embed-1B-NVFP4`](https://deepinfra.com/nvidia/Nemotron-3-Embed-1B-NVFP4) | 0.010 | 2048, MRL | 32768 | 34; **русский есть** | То же, FP4; официальный RTEB 72.0 против 72.4 у BF16 относится только к этой семье. **Нет без адаптера**. |
| [`nvidia/Nemotron-3-Embed-8B`](https://deepinfra.com/nvidia/Nemotron-3-Embed-8B) | 0.035 | 4096, MRL | 32768 | 34; **русский есть** | Query/passsage formatting обязательно. Самый дорогой open-weight кандидат каталога. **Нет без адаптера**. |
| [`nvidia/llama-nemotron-embed-vl-1b-v2`](https://deepinfra.com/nvidia/llama-nemotron-embed-vl-1b-v2) | 0.010 | 2048 | 10240 | multilingual не заявлен; русский не подтвержден | Мультимодальный text/image retrieval; роль должна добавить `query:` или `passage:`. Авторы прямо предупреждают, что без template результаты неверны. **Нет**. |
| [`sentence-transformers/all-MiniLM-L12-v2`](https://deepinfra.com/sentence-transformers/all-MiniLM-L12-v2) | 0.005 | 384 | 512 | English; русский не целевой | Симметричный sentence similarity, cosine. Transport совместим, **не подходит по языку/задаче**. |
| [`sentence-transformers/all-MiniLM-L6-v2`](https://deepinfra.com/sentence-transformers/all-MiniLM-L6-v2) | 0.005 | 384 | 512 | English; русский не целевой | Аналогично; дешевый, но не русский RAG. |
| [`sentence-transformers/all-mpnet-base-v2`](https://deepinfra.com/sentence-transformers/all-mpnet-base-v2) | 0.005 | 768 | 512 | English; русский не целевой | Симметричный similarity, cosine; не русский retrieval. |
| [`sentence-transformers/clip-ViT-B-32`](https://deepinfra.com/sentence-transformers/clip-ViT-B-32) | 0.005 | 512 | 77 | English | Text-image CLIP, не document RAG. **Нет**. |
| [`sentence-transformers/clip-ViT-B-32-multilingual-v1`](https://deepinfra.com/sentence-transformers/clip-ViT-B-32-multilingual-v1) | 0.005 | 512 | 512 | 50+; русский есть | Multilingual text-image alignment, не document retrieval. **Нет**. |
| [`sentence-transformers/multi-qa-mpnet-base-dot-v1`](https://deepinfra.com/sentence-transformers/multi-qa-mpnet-base-dot-v1) | 0.005 | 768 | 512 | English; нет | QA retrieval, но обучена под dot product и English. Ненормированный dot-product space не совпадает с L2. **Нет**. |
| [`sentence-transformers/paraphrase-MiniLM-L6-v2`](https://deepinfra.com/sentence-transformers/paraphrase-MiniLM-L6-v2) | 0.005 | 384 | 512 | English; нет | Paraphrase similarity, не русский retrieval. **Нет**. |
| [`shibing624/text2vec-base-chinese`](https://deepinfra.com/shibing624/text2vec-base-chinese) | 0.005 | 768 | 512 | Chinese; нет | CoSENT/cosine, китайская модель. **Нет**. |
| [`thenlper/gte-base`](https://deepinfra.com/thenlper/gte-base) | 0.005 | 768 | 512 | English; нет | Симметричный dense retrieval, но English. **Нет** для русского. |
| [`thenlper/gte-large`](https://deepinfra.com/thenlper/gte-large) | 0.010 | 1024 | 512 | English; нет | Аналогично. **Нет** для русского. |

### Deprecated, но еще присутствуют в embedded-каталоге

Эти три записи помечены `deprecated` с 2026-07-06 и заменены соответствующими обычными Qwen endpoints; для нового подключения их выбирать нельзя.

| Model ID | Последняя цена $ / 1M | Размерность | Контекст | Статус |
|---|---:|---:|---:|---|
| `Qwen/Qwen3-Embedding-0.6B-batch` | 0.005 | 1024 | 32768 | deprecated → `Qwen/Qwen3-Embedding-0.6B` |
| `Qwen/Qwen3-Embedding-4B-batch` | 0.010 | 2560 | 32768 | deprecated → `Qwen/Qwen3-Embedding-4B` |
| `Qwen/Qwen3-Embedding-8B-batch` | 0.040 | 4096 | 32768 | deprecated → `Qwen/Qwen3-Embedding-8B` |

## `bge-m3` и `bge-m3-multi`

Обе записи используют семейство BGE-M3 и стоят одинаково. Разница — контракт endpoint:

- [`BAAI/bge-m3`](https://deepinfra.com/BAAI/bge-m3/api) — обычный embedding endpoint: один dense-вектор на input, опциональные `dimensions`, `custom_instruction` и `normalize` в native API. Это подходящий контракт для SQLite-vec.
- [`BAAI/bge-m3-multi`](https://deepinfra.com/BAAI/bge-m3-multi/api) — native endpoint с переключателями `dense`, `sparse`, `colbert`; ответ может содержать dense embeddings, lexical weights и отдельный ColBERT-вектор каждого токена.
- OpenAI-compatible schema присутствует у обеих записей, поэтому `bge-m3-multi` способен деградировать до обычного dense-ответа. Но LangChain `OpenAIEmbeddings` не запрашивает sparse/ColBERT и Grounded не хранит такие индексы. Платить одинаково за одинаковый dense смысл есть только у `bge-m3`; `multi` нужен после архитектурной доработки hybrid retrieval.

## Нормализация и L2

Grounded создает `FLOAT[N]` в SQLite-vec без указания distance metric; тест проекта фиксирует фактическую **Euclidean/L2 distance**. Для единичных векторов:

`||a-b||² = 2 - 2·cos(a,b)`

Поэтому порядок L2 и cosine одинаков только после L2-нормализации. Официальные примеры BGE-M3, Qwen3, E5 и Nemotron нормализуют output. Но это не доказывает, что конкретный hosted OpenAI endpoint делает то же самое. В [native API `BAAI/bge-m3`](https://deepinfra.com/BAAI/bge-m3/api) `normalize` имеет default `false`; стандартный LangChain-клиент этот нестандартный параметр не отправляет.

Перед переиндексацией надо вызвать именно `https://api.deepinfra.com/v1/openai/embeddings`, посчитать L2 norm нескольких ответов и проверить, что она близка к 1. Если нет, прямой DeepInfra BGE-M3 нельзя считать полностью совместимым с текущим Grounded.

## Shortlist по цене/качеству

1. **Лучший для русского RAG без query/document-адаптера: `BAAI/bge-m3`.** $0.010/M, 1024d, 8K, 100+ языков. Это единственный сильный multilingual retrieval-кандидат каталога, которому не нужен асимметричный prefix. Условие — подтвердить нормализацию OpenAI route.
2. **Лучший бюджетный:** формально `google/embeddinggemma-300m` за $0.002/M, но для качественного retrieval нужны разные query/document prompts. Поэтому в строгом режиме «совсем без доработок» бюджетный выбор снова `BAAI/bge-m3`; дешевые $0.005 модели преимущественно English/Chinese.
3. **Лучший кандидат по абсолютному качеству после небольшого адаптера:** `nvidia/Nemotron-3-Embed-8B` ($0.035/M) либо `Qwen/Qwen3-Embedding-8B` ($0.010/M). Их официальные лидерборды несопоставимы напрямую; для книг 1С нужен одинаковый тест. Qwen выгоднее по цене, но уже показал, что plain-query режим может проиграть BGE-M3.
4. **Лучший price/quality после адаптера:** `Qwen/Qwen3-Embedding-8B` по текущей аномально низкой цене $0.010/M (4B стоит $0.020/M). Добавление инструкции только к query — обязательная часть честного повторного сравнения.
5. **Не подходят без адаптера:** все E5, EmbeddingGemma, Nemotron text/VL и Qwen для их оптимального режима; `bge-m3-multi` не дает hybrid-поиск без новых индексов; CLIP — другая задача; English/Chinese-only модели не подходят для библиотеки 1С.

## Практическое решение для сервера

1. Вернуть существующий индекс на BGE-M3 из резервной копии.
2. Не менять production endpoint до дешевого probe прямого DeepInfra: dimension `1024`, обычный float-array, нормы нескольких русских строк около `1.0`.
3. Если нормы единичные, провести полный локальный тест теми же вопросами как новый провайдерный прогон. Модель та же, но tokenizer/runtime/precision и нормализация провайдера способны изменить ранжирование.
4. Если нормы не единичные, оставить Polza либо добавить в Grounded маленький wrapper нормализации. `bge-m3-multi` эту проблему не решает.
