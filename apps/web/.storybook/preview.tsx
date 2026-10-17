import '../src/index.css';
import type { Preview } from '@storybook/react-vite';
import { TooltipProvider } from '../src/components/ui/tooltip';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Light or dark mode',
      toolbar: { title: 'Theme', icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (Story, context) => {
      document.documentElement.classList.toggle('dark', context.globals.theme === 'dark');
      return (
        <TooltipProvider>
          <div className="bg-background p-6 text-foreground">
            <Story />
          </div>
        </TooltipProvider>
      );
    },
  ],
  parameters: { layout: 'fullscreen', controls: { expanded: true } },
};

export default preview;
