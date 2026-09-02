import { fetchAccountApi } from "@/lib/api/archive";
import type { AccountData } from "@/lib/types";
import {
  createAsyncDataState,
  getErrorMessage,
  type RequestStatus,
} from "@/store/asyncData";
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";

const initialState = createAsyncDataState<AccountData>();

const accountSlice = createSlice({
  name: "accountData",
  initialState,
  reducers: {
    changeData: (state, action: PayloadAction<AccountData>) => {
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
  changeData: changeAccountData,
  changeStatus: changeAccountStatus,
  changeError: changeAccountError,
} = accountSlice.actions;

export const fetchAccountData = createAsyncThunk<
  void,
  void,
  { rejectValue: string }
>("accountData/fetch", async (_, { dispatch, rejectWithValue }) => {
  dispatch(changeAccountStatus("loading"));
  dispatch(changeAccountError(null));
  try {
    const data = await fetchAccountApi();
    dispatch(changeAccountData(data));
    dispatch(changeAccountStatus("succeeded"));
  } catch (error) {
    const message = getErrorMessage(error);
    dispatch(changeAccountError(message));
    dispatch(changeAccountStatus("failed"));
    return rejectWithValue(message);
  }
});

export default accountSlice.reducer;
