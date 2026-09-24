import { archiveOrderApi, fetchOrdersApi } from "@/lib/api/archive";
import { adaptOrders } from "@/adapters/orderAdapter";
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
    const data = adaptOrders(rows);
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
