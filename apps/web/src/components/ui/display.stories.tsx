import type { Meta, StoryObj } from '@storybook/react-vite';
import { CheckCircle2, FolderLock, Info } from 'lucide-react';
import { EmptyState, PageHeader, Spinner, StatusDot } from '../common';
import { UserAvatar } from '../layout/user';
import { RecoveryCodes } from '../TwoFactorSetup';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Kbd } from './kbd';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const meta = { title: 'UI/Display' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Admin</Badge>
      <Badge variant="secondary">Member</Badge>
      <Badge variant="outline">Soon</Badge>
      <Badge variant="destructive">Failed</Badge>
      <span className="flex items-center gap-1.5">
        <StatusDot tone="ok" /> Configured
      </span>
      <span className="flex items-center gap-1.5">
        <StatusDot tone="off" /> Off
      </span>
      <Kbd>Ctrl K</Kbd>
    </div>
  ),
};

export const Cards: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <Card className="shadow-none">
        <CardHeader>
          <CardDescription>People with access</CardDescription>
          <CardTitle className="font-mono text-2xl">12</CardTitle>
        </CardHeader>
      </Card>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Finish setting up</CardTitle>
          <CardDescription>2 of 4 done</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm">
              Dismiss
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>Card body</CardContent>
      </Card>
    </div>
  ),
};

export const Alerts: Story = {
  render: () => (
    <div className="grid max-w-xl gap-3">
      <Alert>
        <CheckCircle2 className="text-success" />
        <AlertDescription>Sent a test email to ada@example.com.</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <Info />
        <AlertTitle>Could not reach Postgres</AlertTitle>
        <AlertDescription>Check the host and port in DATABASE_URL.</AlertDescription>
      </Alert>
    </div>
  ),
};

export const TableWithAvatars: Story = {
  render: () => (
    <div className="max-w-2xl rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Shares</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[
            ['Ada Admin', 'Admin', '1 000 000'],
            ['Maria Lindqvist', 'Member', '250 000'],
          ].map(([name, role, shares]) => (
            <TableRow key={name}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <UserAvatar name={name!} className="size-7" /> {name}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{role}</Badge>
              </TableCell>
              <TableCell className="text-right font-mono">{shares}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

export const TabsAndHeader: Story = {
  render: () => (
    <div className="max-w-2xl">
      <PageHeader title="Account" description="Your profile, security and connected clients." actions={<Button>Save</Button>} />
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="pt-4">
          Profile content
        </TabsContent>
      </Tabs>
    </div>
  ),
};

export const LoadingAndEmpty: Story = {
  render: () => (
    <div className="grid max-w-xl gap-4">
      <Spinner />
      <div className="grid gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <EmptyState icon={<FolderLock />} title="Coming soon">
        The dataroom is the next part to be built.
      </EmptyState>
    </div>
  ),
};

export const RecoveryCodeList: Story = {
  render: () => <RecoveryCodes codes={['a7k2m-q9xpz', 'b3n8r-t2vwy', 'c5h4j-w7kmn', 'd9p2s-x3ztq']} onDone={() => {}} />,
};
