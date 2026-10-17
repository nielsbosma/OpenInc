import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Combobox } from '../Combobox';
import { Field } from '../common';
import { Checkbox } from './checkbox';
import { Input } from './input';
import { Label } from './label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Switch } from './switch';
import { Textarea } from './textarea';

const meta = { title: 'UI/Forms' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Inputs: Story = {
  render: () => (
    <div className="grid max-w-sm gap-4">
      <Field label="Company name" htmlFor="s-name">
        <Input id="s-name" placeholder="Acme AB" />
      </Field>
      <Field label="Email" htmlFor="s-email" error="Enter a valid email address">
        <Input id="s-email" aria-invalid defaultValue="not-an-email" />
      </Field>
      <Field label="Shares" htmlFor="s-shares" hint="Whole shares only">
        <Input id="s-shares" className="font-mono" defaultValue="1 250 000" />
      </Field>
      <Field label="Address" htmlFor="s-address">
        <Textarea id="s-address" rows={2} />
      </Field>
      <Field label="Disabled" htmlFor="s-disabled">
        <Input id="s-disabled" disabled defaultValue="Pinned by environment variable" />
      </Field>
    </div>
  ),
};

export const Choices: Story = {
  render: function Render() {
    const [role, setRole] = useState('member');
    const [tz, setTz] = useState('Europe/Stockholm');
    return (
      <div className="grid max-w-sm gap-4">
        <Field label="Role" htmlFor="s-role">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger id="s-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="readonly">Read-only</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Time zone (searchable)" htmlFor="s-tz">
          <Combobox
            id="s-tz"
            value={tz}
            onChange={setTz}
            options={['Europe/Stockholm', 'Europe/London', 'America/New_York', 'Asia/Tokyo'].map((v) => ({ value: v, label: v }))}
          />
        </Field>
        <label className="flex items-center gap-2">
          <Switch defaultChecked /> Require two-factor authentication
        </label>
        <div className="flex items-center gap-2">
          <Checkbox id="s-check" defaultChecked />
          <Label htmlFor="s-check">Send me a copy</Label>
        </div>
      </div>
    );
  },
};
