/**
 * Table primitives matching the mockup's `.tbl` (used for the libraries
 * list, recently-finished jobs, etc.). `Table` wraps its `<table>` in the
 * `.table-wrap` scroll container; `Th`/`Td` accept `num` for right-aligned,
 * tabular-numeral columns.
 *
 * @example
 * <Table>
 *   <TableHead>
 *     <tr><Th>Library</Th><Th num>Pages</Th></tr>
 *   </TableHead>
 *   <TableBody>
 *     <tr><Td>react</Td><Td num>3,120</Td></tr>
 *   </TableBody>
 * </Table>
 */
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLTableElement>) {
  const classes = className ? `tbl ${className}` : "tbl";
  return (
    <div className="table-wrap">
      <table className={classes} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function TableHead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export interface CellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-align + tabular numerals (`.num`), for numeric columns. */
  num?: boolean;
}

export function Th({ num, className, ...rest }: CellProps) {
  const classes =
    [num ? "num" : "", className ?? ""].filter(Boolean).join(" ") || undefined;
  return <th className={classes} {...rest} />;
}

export function Td({
  num,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  const classes =
    [num ? "num" : "", className ?? ""].filter(Boolean).join(" ") || undefined;
  return <td className={classes} {...rest} />;
}
