import { fetchProductsApi } from "@/lib/api/archive";
import type { Product } from "@/lib/types";
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

const initialState = createAsyncDataState<Product[]>();

const productsSlice = createSlice({
  name: "productsData",
  initialState,
  reducers: {
    changeData: (state, action: PayloadAction<Product[]>) => {
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
  changeData: changeProductsData,
  changeStatus: changeProductsStatus,
  changeError: changeProductsError,
} = productsSlice.actions;

export const fetchProductsData = createAsyncThunk<
  void,
  void,
  { rejectValue: string }
>("productsData/fetch", async (_, { dispatch, rejectWithValue }) => {
  dispatch(changeProductsStatus("loading"));
  dispatch(changeProductsError(null));
  try {
    const data = await fetchProductsApi();
    dispatch(changeProductsData(data));
    dispatch(changeProductsStatus("succeeded"));
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch(changeProductsError(message));
    dispatch(changeProductsStatus("failed"));
    return rejectWithValue(message);
  }
});

export default productsSlice.reducer;
