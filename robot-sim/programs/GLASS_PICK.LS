/PROG  GLASS_PICK
/ATTR
OWNER		= MNEDITOR;
COMMENT		= "GLASS PICK";
PROG_SIZE	= 0;
CREATE		= DATE 26-11-07  TIME 17:20:43;
MODIFIED	= DATE 26-11-07  TIME 17:20:43;
FILE_NAME	= ;
VERSION		= 0;
LINE_COUNT	= 24;
MEMORY_SIZE	= 0;
PROTECT		= READ_WRITE;
TCD:  STACK_SIZE	= 0,
      TASK_PRIORITY	= 50,
      TIME_SLICE	= 0,
      BUSY_LAMP_OFF	= 0,
      ABORT_REQUEST	= 0,
      PAUSE_REQUEST	= 0;
DEFAULT_GROUP	= 1,*,*,*,*;
CONTROL_CODE	= 00000000 00000000;
/APPL
/MN
   1:  !PICK AND PLACE SAMPLE    ;
   2:  UFRAME_NUM=0    ;
   3:  UTOOL_NUM=1    ;
   4:  RO[1]=OFF    ;
   5:  R[1]=0    ;
   6:  J P[1] 50% FINE    ;
   7:  LBL[1]    ;
   8:  WAIT DI[1]=ON    ;
   9:  J P[2] 50% FINE    ;
  10:  L P[3] 200mm/sec FINE    ;
  11:  RO[1]=ON    ;
  12:  WAIT RI[1]=ON    ;
  13:  WAIT 0.20(sec)    ;
  14:  L P[4] 400mm/sec FINE    ;
  15:  WAIT DI[2]=OFF    ;
  16:  J P[5] 50% FINE    ;
  17:  L P[6] 200mm/sec FINE    ;
  18:  RO[1]=OFF    ;
  19:  WAIT RI[1]=OFF    ;
  20:  WAIT 0.30(sec)    ;
  21:  L P[7] 400mm/sec FINE    ;
  22:  J P[8] 50% FINE    ;
  23:  R[1]=R[1]+1    ;
  24:  IF R[1]<3,JMP LBL[1]    ;
/POS
P[1]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   1010.000  mm,	Y =      0.000  mm,	Z =   1195.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[2]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =    750.000  mm,	Z =    605.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[3]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =    750.000  mm,	Z =    455.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[4]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =    750.000  mm,	Z =    605.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[5]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =   -750.000  mm,	Z =    605.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[6]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =   -750.000  mm,	Z =    455.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[7]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =    950.000  mm,	Y =   -750.000  mm,	Z =    605.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
P[8]{
   GP1:
	UF : 0, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
	X =   1010.000  mm,	Y =      0.000  mm,	Z =   1195.000  mm,
	W =    180.000 deg,	P =      0.000 deg,	R =      0.000 deg
};
/END
