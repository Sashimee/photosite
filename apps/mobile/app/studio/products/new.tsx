import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ProductEditorStates } from '../../../src/components/studio/product-editor-states';
import { ProductForm } from '../../../src/components/studio/product-form';
import { StudioFrame } from '../../../src/components/studio/studio-frame';
import { useProductEditor } from '../../../src/lib/use-product-editor';

export default function NewProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, reload } = useProductEditor(null);

  return (
    <StudioFrame title={t('mobile.studio.products.form.createTitle')}>
      <ProductEditorStates state={state} reload={reload}>
        {({ currency }) => (
          <ProductForm
            existing={null}
            currency={currency}
            onDone={() => {
              router.dismissTo('/studio/products');
            }}
          />
        )}
      </ProductEditorStates>
    </StudioFrame>
  );
}
