import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { components } from '@photoo/api-client';

import { FormNotice } from '../../../src/components/form/form-notice';
import { ConfirmAction } from '../../../src/components/requests/confirm-action';
import { ProductEditorStates } from '../../../src/components/studio/product-editor-states';
import { ProductForm } from '../../../src/components/studio/product-form';
import { StudioFrame } from '../../../src/components/studio/studio-frame';
import { api } from '../../../src/lib/api';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedStudioTranslate,
} from '../../../src/lib/request-errors';
import { useProductEditor } from '../../../src/lib/use-product-editor';

type Product = components['schemas']['Product'];

function DeleteProduct({ product, onDeleted }: { product: Product; onDeleted: () => void }) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const { error: apiError, response } = await api.DELETE('/v1/me/products/{productId}', {
        params: { path: { productId: product.id } },
      });
      if (apiError) {
        setError(
          requestErrorMessage(
            scopedStudioTranslate(t, 'products'),
            apiErrorWithStatus(apiError, response.status),
          ),
        );
        return;
      }
      onDeleted();
    } catch {
      setError(t('mobile.studio.products.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="gap-3">
      {error ? (
        <FormNotice tone="error" testID="product-delete-error">
          {error}
        </FormNotice>
      ) : null}
      <ConfirmAction
        outline
        testID="product-delete"
        triggerLabel={t('mobile.studio.products.deleteCta')}
        title={t('mobile.studio.products.deleteConfirmTitle')}
        description={t('mobile.studio.products.deleteConfirmDescription')}
        confirmLabel={t('mobile.studio.products.deleteConfirmCta')}
        pendingLabel={t('mobile.studio.products.deletePending')}
        dismissLabel={t('mobile.studio.products.deleteDismissCta')}
        pending={pending}
        onConfirm={remove}
      />
    </View>
  );
}

export default function EditProductScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { state, reload } = useProductEditor(productId);

  function backToList() {
    router.dismissTo('/studio/products');
  }

  return (
    <StudioFrame title={t('mobile.studio.products.form.editTitle')}>
      <ProductEditorStates state={state} reload={reload}>
        {({ currency, product }) => (
          <ProductForm
            existing={product}
            currency={currency}
            onDone={backToList}
            footer={product ? <DeleteProduct product={product} onDeleted={backToList} /> : null}
          />
        )}
      </ProductEditorStates>
    </StudioFrame>
  );
}
