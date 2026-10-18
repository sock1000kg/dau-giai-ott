import type { ReactNode } from 'react';

export interface TableColumn<Row> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
}

export interface TableProps<Row> {
  readonly caption: string;
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly emptyMessage: string;
}

export function Table<Row>({ caption, columns, rows, rowKey, emptyMessage }: Readonly<TableProps<Row>>) {
  if (rows.length === 0) return <div className="ui-empty" role="status">{emptyMessage}</div>;
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
