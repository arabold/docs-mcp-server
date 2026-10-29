# Exported functions from "src/web/components/ProgressBar.tsx"

<!--
```json configuration
{ "testing-framework": "vitest" }
```
-->

## default ProgressBar(props: ProgressBarProps) [react]

The type definition for props:
ProgressBarProps

These are the functional requirements for default function `ProgressBar`.

### Tests for showText undefined

| test name  | progress                                         | showText  | screen. | .to |
| ---------- | ------------------------------------------------ | --------- | ------- | --- |
| 0-0-0-u    | {pages: 0, totalPages: 0, totalDiscovered: 0}    | undefined |         |     |
| 0-0-1-u    | {pages: 0, totalPages: 0, totalDiscovered: 1}    | undefined |         |     |
| 0-10-1-u   | {pages: 0, totalPages: 10, totalDiscovered: 1}   | undefined |         |     |
| 0-10-10-u  | {pages: 0, totalPages: 10, totalDiscovered: 10}  | undefined |         |     |
| 3-10-10-u  | {pages: 3, totalPages: 10, totalDiscovered: 10}  | undefined |         |     |
| 10-10-10-u | {pages: 10, totalPages: 10, totalDiscovered: 10} | undefined |         |     |
| 3-10-12-u  | {pages: 3, totalPages: 10, totalDiscovered: 12}  | undefined |         |     |

```typescript scenario(0-0-0-u)
*/
expectProgress(html, 0, 0, 0);
expectedDetermined(html, 0);
```

```typescript scenario(0-10-10-u)
*/
expectProgress(html, 0, 10, 0);
expectedDetermined(html, 0);
```

```typescript scenario(3-10-10-u)
*/
expectProgress(html, 3, 10, 30);
expectedDetermined(html, 30);
```

```typescript scenario(10-10-10-u)
*/
expectProgress(html, 10, 10, 100);
expectedDetermined(html, 100);
```

```typescript scenario(3-10-12-u)
*/
expectProgress(html, 3, 10, 30, 12);
expectedDetermined(html, 30);
```

### Tests for showText false

| test name  | progress                                         | showText | screen. | .to |
| ---------- | ------------------------------------------------ | -------- | ------- | --- |
| 0-0-0-f    | {pages: 0, totalPages: 0, totalDiscovered: 0}    | false    |         |     |
| 0-0-1-f    | {pages: 0, totalPages: 0, totalDiscovered: 1}    | false    |         |     |
| 0-10-1-f   | {pages: 0, totalPages: 10, totalDiscovered: 1}   | false    |         |     |
| 0-10-10-f  | {pages: 0, totalPages: 10, totalDiscovered: 10}  | false    |         |     |
| 3-10-10-f  | {pages: 3, totalPages: 10, totalDiscovered: 10}  | false    |         |     |
| 10-10-10-f | {pages: 10, totalPages: 10, totalDiscovered: 10} | false    |         |     |
| 3-10-12-f  | {pages: 3, totalPages: 10, totalDiscovered: 12}  | false    |         |     |

```typescript scenario(0-0-0-f)
*/
expectNoProgress(html);
expectedDetermined(html, 0);
```

```typescript scenario(0-0-1-f)
*/
expectNoProgress(html);
expectedIndetermined(html);
```

```typescript scenario(0-10-1-f)
*/
expectNoProgress(html);
expectedIndetermined(html);
```

```typescript scenario(0-10-10-f)
*/
expectNoProgress(html);
expectedDetermined(html, 0);
```

```typescript scenario(3-10-10-f)
*/
expectNoProgress(html);
expectedDetermined(html, 30);
```

```typescript scenario(10-10-10-f)
*/
expectNoProgress(html);
expectedDetermined(html, 100);
```

```typescript scenario(3-10-12-f)
*/
expectNoProgress(html);
expectedDetermined(html, 30);
```

### Tests for showText true

| test name  | progress                                         | showText | screen. | .to |
| ---------- | ------------------------------------------------ | -------- | ------- | --- |
| 0-0-0-t    | {pages: 0, totalPages: 0, totalDiscovered: 0}    | true     |         |     |
| 0-0-1-t    | {pages: 0, totalPages: 0, totalDiscovered: 1}    | true     |         |     |
| 0-10-1-t   | {pages: 0, totalPages: 10, totalDiscovered: 1}   | true     |         |     |
| 0-10-10-t  | {pages: 0, totalPages: 10, totalDiscovered: 10}  | true     |         |     |
| 3-10-10-t  | {pages: 3, totalPages: 10, totalDiscovered: 10}  | true     |         |     |
| 10-10-10-t | {pages: 10, totalPages: 10, totalDiscovered: 10} | true     |         |     |
| 3-10-12-t  | {pages: 3, totalPages: 10, totalDiscovered: 12}  | true     |         |     |

```typescript scenario(0-0-0-t)
*/
expectProgress(html, 0, 0, 0);
expectedDetermined(html, 0);
```

```typescript scenario(0-10-10-t)
*/
expectProgress(html, 0, 10, 0);
expectedDetermined(html, 0);
```

```typescript scenario(3-10-10-t)
*/
expectProgress(html, 3, 10, 30);
expectedDetermined(html, 30);
```

```typescript scenario(10-10-10-t)
*/
expectProgress(html, 10, 10, 100);
expectedDetermined(html, 100);
```

```typescript scenario(3-10-12-t)
*/
expectProgress(html, 3, 10, 30, 12);
expectedDetermined(html, 30);
```

---

We define some helper functions:

```typescript after
function expectProgress(html: string, v1: number, v2: number, v3: number, v4?: number) {
  const overflow = v4 ? ` • ${v4} total` : '';
  expect(html).toContain('<span>Progress</span>');
  expect(html).toContain(`<span>${v1}/${v2} pages (${v3}%)${overflow}</span>`);
}

function expectNoProgress(html: string) {
  expect(html).not.toContain('<span>Progress</span>');
  expect(html).not.toMatch(/\d+\/\d+ pages \(\d+%\)/);
}

function expectDiscovering(html: string) {
  expect(html).toContain('<span>Progress</span>');
  expect(html).toContain('<span>Discovering pages...</span>');
}

function expectedDetermined(html: string, v: number) {
  expect(html).toContain(`transition-all duration-300" style="width: ${v}%"`);
}

function expectedIndetermined(html: string) {
  expect(html).toContain('animate-pulse" style="width: 30%"');
}
```

As 3TG assumes React is present for a `.tsx` file, we need to use a workaround to disable the `React Testing Library` code

```json configuration
{
  "in-tests": {
    "*": ["const html = ProgressBar({ ...props }) as string;", "/*"]
  },
  "in-tests-at-end": {
    "*": ["*/", "expectDiscovering(html);", "expectedIndetermined(html);"]
  }
}
```

Afterwards, we will remove the commented blocks
