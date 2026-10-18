import type { Meta, StoryObj } from '@storybook/react-vite';
import { LineChart, ShareBar, StackedAreaChart } from './charts';

const meta = { title: 'Components/Charts' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const series = [
  { key: 'founders', name: 'Founders', color: '#6366f1' },
  { key: 'investors', name: 'Investors', color: '#10b981' },
  { key: 'pool', name: 'Unallocated Pool', color: '#14b8a6' },
];

export const OwnershipOverTime: Story = {
  render: () => (
    <StackedAreaChart
      className="max-w-2xl"
      series={series}
      markers={[2]}
      points={[
        { label: '2023-01', values: { founders: 100, investors: 0, pool: 0 } },
        { label: '2023-06', values: { founders: 90, investors: 0, pool: 10 } },
        { label: '2024-03', values: { founders: 70, investors: 20, pool: 10 } },
        { label: '2025-01', values: { founders: 55, investors: 33, pool: 12 } },
      ]}
    />
  ),
};

export const Breakpoints: Story = {
  render: () => (
    <LineChart
      className="max-w-2xl"
      series={series.slice(0, 2)}
      formatX={(v) => `${v}M`}
      formatY={(v) => `${v}M`}
      points={[0, 5, 10, 20, 40].map((x) => ({
        x,
        values: { founders: Math.max(0, x - 5) * 0.6, investors: Math.min(x, 5) + Math.max(0, x - 5) * 0.4 },
      }))}
    />
  ),
};

export const Ownership: Story = {
  render: () => (
    <ShareBar
      className="max-w-xl"
      parts={[
        { key: 'f', name: 'Founders', value: 62, color: '#6366f1' },
        { key: 'i', name: 'Investors', value: 28, color: '#10b981' },
        { key: 'p', name: 'Pool', value: 10, color: '#14b8a6' },
      ]}
    />
  ),
};
