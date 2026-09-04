import {
  archiveOrderApi,
  fetchOrdersApi,
  type OrderRow,
} from "@/lib/api/archive";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/constants";
import type { Order } from "@/lib/types";
import {
  createAsyncDataState,
  getErrorMessage,
  type RequestStatus,
} from "@/store/asyncData";
import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";

const initialState = createAsyncDataState<Order[]>();

const firstRelation = <T>(relation: T | T[] | null): T | null =>
  Array.isArray(relation) ? (relation[0] ?? null) : relation;

const formatOrdersData = (rows: OrderRow[]): Order[] =>
  rows.map((row) => {
    const customer = firstRelation(row.customers);
    const items = row.order_items;
    if (!Array.isArray(items)) {
      throw new Error(`訂單 ${row.order_no} 缺少商品明細。`);
    }

    return {
      dbId: row.id,
      id: row.order_no,
      ownerId: row.owner_id,
      customer: customer?.nickname || customer?.name || "未填寫客人",
      createdAt: new Date(row.created_at).toLocaleDateString("zh-TW"),
      status: ORDER_STATUS_LABELS[row.status] || row.status,
      payment: PAYMENT_STATUS_LABELS[row.payment_status] || row.payment_status,
      itemIds: items.flatMap((item) => {
        const sku = firstRelation(item.products)?.sku;
        return sku ? Array.from({ length: item.quantity }, () => sku) : [];
      }),
      packedIds: items.flatMap((item) => {
        const sku = firstRelation(item.products)?.sku;
        return item.scanned_quantity >= item.quantity && sku ? [sku] : [];
      }),
    };
  });

const ordersSlice = createSlice({
  name: "ordersData",
  initialState,
  reducers: {
    changeData: (state, action: PayloadAction<Order[]>) => {
      state.data = action.payload;
    },
    changeStatus: (state, action: PayloadAction<RequestStatus>) => {
      state.status = action.payload;
    },
    changeError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
});

export const {
  changeData: changeOrdersData,
  changeStatus: changeOrdersStatus,
  changeError: changeOrdersError,
} = ordersSlice.actions;

export const fetchOrdersData = createAsyncThunk<
  void,
  void,
  { rejectValue: string }
>("ordersData/fetchOrdersData", async (_, thunkApi) => {
  const { dispatch, rejectWithValue } = thunkApi;
  dispatch(changeOrdersStatus("loading"));
  dispatch(changeOrdersError(null));
  try {
    const rows = await fetchOrdersApi();
    const data = formatOrdersData(rows);
    dispatch(changeOrdersData(data));
    dispatch(changeOrdersStatus("succeeded"));
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch(changeOrdersError(message));
    dispatch(changeOrdersStatus("failed"));
    return rejectWithValue(message);
  }
});

export const archiveOrder = createAsyncThunk<
  void,
  { orderId: string },
  { rejectValue: string }
>("ordersData/archive", async ({ orderId }, { rejectWithValue }) => {
  try {
    await archiveOrderApi(orderId);
  } catch (error) {
    return rejectWithValue(getErrorMessage(error));
  }
});

export default ordersSlice.reducer;
