import { combineReducers } from "@reduxjs/toolkit";
import accountData from "@/store/slices/accountSlice";
import ordersData from "@/store/slices/ordersSlice";
import productsData from "@/store/slices/productsSlice";
import ui from "@/store/slices/uiSlice";

export const rootReducer = combineReducers({
  ui,
  productsData,
  ordersData,
  accountData,
});
