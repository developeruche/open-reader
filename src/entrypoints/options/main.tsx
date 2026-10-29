import { mount } from '@/ui/mount';
import { OptionsApp } from '@/ui/shells/OptionsApp';

mount((useAppearance) => <OptionsApp useAppearance={useAppearance} />);

// Test builds: hooks for the model smoke tests (`pnpm test:models`).
if (import.meta.env.MODE === 'test') {
  void import('@/runtime/modelTestHooks').then((m) =>
    Object.assign(window, { __models: m.modelTestHooks }),
  );
}
